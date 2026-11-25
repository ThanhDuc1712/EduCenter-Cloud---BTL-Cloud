"""EduCenter material-processor — Alibaba Cloud Function Compute 3.0 (Python 3.12), OSS trigger.

Flow per ObjectCreated event on the quarantine bucket:
  1. accept only keys  tenants/<uuid>/materials/<uuid>/source.pdf
  2. idempotency: if results/<tenant>/<material>.json already exists for this source version,
     re-send that result (same eventId) instead of processing again
  3. download, validate PDF (size, structure, encryption, pages), read metadata, render preview
  4. write document.pdf + preview.png + result JSON to the published bucket
  5. HMAC-signed callback to the Azure API; on failure raise so FC's async retry runs again
     (the reconciler on Azure also replays the stored result JSON)

Credentials come from the function's RAM role (context.credentials, STS) — no keys in code.
Logs are JSON lines on stdout → SLS logstore, each with a correlationId.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone

import callback as cb
import processor

RESULT_SCHEMA = "educenter.material-result/v1"
KEY_RE = re.compile(r"^tenants/([0-9a-f-]{36})/materials/([0-9a-f-]{36})/source\.pdf$")


def _env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise RuntimeError(f"missing environment variable {name}")
    return value


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Logger:
    def __init__(self, request_id: str):
        self.base = {"function": "material-processor", "requestId": request_id}

    def bind(self, **fields):
        self.base.update({k: v for k, v in fields.items() if v is not None})

    def __call__(self, level: str, event: str, **fields):
        print(json.dumps({"time": _now_iso(), "level": level, "event": event, **self.base, **fields}, ensure_ascii=False), flush=True)


class OssStorage:
    """Thin wrapper over oss2 so the handler can be tested with an in-memory fake."""

    def __init__(self, context, endpoint: str, quarantine_bucket: str, published_bucket: str):
        import oss2

        creds = context.credentials
        auth = oss2.StsAuth(creds.access_key_id, creds.access_key_secret, creds.security_token)
        self.q = oss2.Bucket(auth, endpoint, quarantine_bucket)
        self.p = oss2.Bucket(auth, endpoint, published_bucket)
        self._oss2 = oss2

    def head_source(self, key: str):
        try:
            h = self.q.head_object(key)
        except self._oss2.exceptions.NoSuchKey:
            return None
        meta = {k[len("x-oss-meta-"):]: v for k, v in h.headers.items() if k.lower().startswith("x-oss-meta-")}
        return {"size": h.content_length, "version_id": h.headers.get("x-oss-version-id"), "meta": {k.lower(): v for k, v in meta.items()}}

    def get_source(self, key: str, version_id: str | None) -> bytes:
        params = {"versionId": version_id} if version_id else None
        return self.q.get_object(key, params=params).read()

    def get_result(self, key: str):
        try:
            return self.p.get_object(key).read()
        except self._oss2.exceptions.NoSuchKey:
            return None

    def put_published(self, key: str, data: bytes, content_type: str):
        self.p.put_object(key, data, headers={"Content-Type": content_type})


def parse_events(event) -> list:
    raw = event.decode("utf-8") if isinstance(event, (bytes, bytearray)) else event
    data = json.loads(raw) if isinstance(raw, str) else raw
    return data.get("events", [])


def process_object(key: str, storage, settings: dict, request_id: str, log: Logger, send=cb.send_callback) -> dict:
    """Processes one quarantine object. Returns a small summary; raises if the callback could not be delivered."""
    m = KEY_RE.match(key)
    if not m:
        log("WARN", "object.ignored", key=key, reason="UNEXPECTED_KEY")
        return {"status": "IGNORED"}
    tenant_id, material_id = m.group(1), m.group(2)
    result_key = f"results/{tenant_id}/{material_id}.json"

    head = storage.head_source(key)
    if head is None:
        log("WARN", "object.missing", key=key)
        return {"status": "IGNORED"}
    meta = head["meta"]
    correlation_id = meta.get("correlation-id") or f"fc-{material_id[:8]}-{request_id[:8]}"
    log.bind(correlationId=correlation_id, materialId=material_id, tenantId=tenant_id)
    if meta.get("material-id") and meta["material-id"] != material_id:
        log("ERROR", "object.metadata_mismatch")
        return {"status": "IGNORED"}

    # Idempotency: same source version already processed → just (re)deliver the stored result.
    existing = storage.get_result(result_key)
    if existing:
        try:
            prev = json.loads(existing)
        except ValueError:
            prev = None
        if prev and prev.get("sourceVersionId") == head["version_id"] and prev.get("sourceKey") == key:
            log("INFO", "result.reused", eventId=prev.get("eventId"))
            ok = send(settings["callback_url"], settings["key_id"], settings["secret"], existing, log)
            if not ok:
                raise RuntimeError("callback delivery failed")
            return {"status": prev.get("status"), "reused": True}

    started_at = _now_iso()
    t0 = time.monotonic()
    log("INFO", "processing.started", size=head["size"], versionId=head["version_id"])

    base = {
        "schema": RESULT_SCHEMA,
        "eventId": f"fc:{request_id}"[:100],
        "tenantId": tenant_id,
        "materialId": material_id,
        "sourceKey": key,
        "sourceVersionId": head["version_id"],
        "correlationId": correlation_id,
        "processor": "ALIYUN_FC",
        "attempt": int(meta.get("attempt", "1") or 1),
        "startedAt": started_at,
    }

    if head["size"] > settings["max_bytes"]:
        outcome = processor.Rejected("TOO_LARGE", f"Tệp vượt quá {settings['max_bytes'] // (1024 * 1024)} MB")
    else:
        data = storage.get_source(key, head["version_id"])
        outcome = processor.process_pdf(data, settings["max_bytes"], settings["max_pages"])

    if isinstance(outcome, processor.Accepted):
        doc_key = f"tenants/{tenant_id}/materials/{material_id}/document.pdf"
        storage.put_published(doc_key, data, "application/pdf")
        preview_key = None
        if outcome.preview_png:
            preview_key = f"tenants/{tenant_id}/materials/{material_id}/preview.png"
            storage.put_published(preview_key, outcome.preview_png, "image/png")
        elif outcome.preview_error:
            log("WARN", "preview.failed", error=outcome.preview_error)
        result = {
            **base,
            "status": "READY",
            "result": {
                "sizeBytes": outcome.size_bytes,
                "sha256": outcome.sha256,
                "pageCount": outcome.page_count,
                "title": outcome.title,
                "author": outcome.author,
                "documentKey": doc_key,
                "previewKey": preview_key,
                "previewContentType": "image/png" if preview_key else None,
            },
            "error": None,
        }
    else:
        result = {**base, "status": "REJECTED", "result": None, "error": {"code": outcome.code, "message": outcome.message}}

    result["finishedAt"] = _now_iso()
    result["durationMs"] = int((time.monotonic() - t0) * 1000)
    raw = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    # Result JSON first: the Azure reconciler can apply it even if every callback attempt fails.
    storage.put_published(result_key, raw, "application/json")
    log("INFO" if result["status"] == "READY" else "WARN", f"processing.{result['status'].lower()}", durationMs=result["durationMs"], pages=(result["result"] or {}).get("pageCount"), error=(result["error"] or {}).get("code"))

    if not send(settings["callback_url"], settings["key_id"], settings["secret"], raw, log):
        log("ERROR", "callback.gave_up")
        raise RuntimeError("callback delivery failed")
    return {"status": result["status"], "durationMs": result["durationMs"]}


def handler(event, context):
    request_id = getattr(context, "request_id", None) or f"local-{int(time.time() * 1000)}"
    log = Logger(request_id)
    settings = {
        "callback_url": _env("CALLBACK_URL"),
        "key_id": _env("CALLBACK_HMAC_KEY_ID"),
        "secret": _env("CALLBACK_HMAC_SECRET"),
        "max_bytes": int(_env("MAX_BYTES", str(10 * 1024 * 1024))),
        "max_pages": int(_env("MAX_PAGES", "500")),
    }
    if len(settings["secret"]) < 32:
        raise RuntimeError("CALLBACK_HMAC_SECRET must be at least 32 characters")
    storage = OssStorage(context, _env("OSS_ENDPOINT"), _env("QUARANTINE_BUCKET"), _env("PUBLISHED_BUCKET"))
    summaries = []
    for ev in parse_events(event):
        key = ev.get("oss", {}).get("object", {}).get("key", "")
        log("INFO", "event.received", eventName=ev.get("eventName"), key=key)
        summaries.append(process_object(key, storage, settings, request_id, log))
    return json.dumps({"processed": summaries})
