"""EduCenter material-processor — Function Compute 3.0, runtime Python 3.10.

Luồng (P0-15, P2-08):
  OSS trigger (quarantine/) -> đọc ĐÚNG versionId trong event -> validate PDF
  -> ghi published/ + previews/ + results/ (results trước callback)
  -> callback HTTPS + HMAC-SHA256 tới Azure (nếu đã cấu hình CALLBACK_URL).

Biến môi trường (cấu hình trong FC console, KHÔNG commit giá trị):
  PUBLISHED_BUCKET        tên bucket published (bắt buộc)
  OSS_ENDPOINT            mặc định https://oss-<region>-internal.aliyuncs.com
  REQUIRE_VERSION_ID      "true" (mặc định) -> event thiếu versionId thì FAILED, không đọc bản mới nhất
  CALLBACK_URL            ví dụ https://<default-domain>/api/v1/internal/material-events (để trống = chưa có API)
  CALLBACK_HMAC_KEY_ID    ví dụ k1-20261122
  CALLBACK_HMAC_KEY       64 ký tự hex (256 bit). Không bao giờ in ra log.
  CALLBACK_MAX_ATTEMPTS   mặc định 5

Định dạng chữ ký callback dưới đây là ĐỀ XUẤT, phải khớp contract P0-16 do Anh/Hà viết:
  X-EduCenter-Key-Id, X-EduCenter-Timestamp (epoch giây),  (gitleaks:allow)
  X-EduCenter-Signature = hex(HMAC_SHA256(key, f"{timestamp}." + raw_body))
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

import oss2  # có sẵn trong built-in runtime Python của FC

from validator import READY, REJECTED, ValidationResult, render_first_page_png, validate_pdf

FAILED = "FAILED"
QUARANTINE_PREFIX = "quarantine/"
KEY_PATTERN = re.compile(r"^quarantine/(?P<rel>[A-Za-z0-9._\-/]+)\.pdf$")
SAFE = re.compile(r"[^A-Za-z0-9._\-]")


def log(**fields) -> None:
    """Một dòng JSON mỗi sự kiện -> SLS tìm được theo correlationId."""
    fields.setdefault("ts", datetime.now(timezone.utc).isoformat(timespec="milliseconds"))
    print(json.dumps(fields, ensure_ascii=False, sort_keys=True), flush=True)


def _find_ci(d: dict, *names):
    lower = {str(k).lower(): v for k, v in d.items()}
    for n in names:
        if n.lower() in lower:
            return lower[n.lower()]
    return None


def _oss_bucket(context, bucket_name: str) -> oss2.Bucket:
    creds = context.credentials  # gitleaks:allow
    auth = oss2.StsAuth(creds.access_key_id, creds.access_key_secret, creds.security_token)
    region = os.environ.get("FC_REGION") or getattr(context, "region", None) or "ap-southeast-1"
    endpoint = os.environ.get("OSS_ENDPOINT") or f"https://oss-{region}-internal.aliyuncs.com"
    return oss2.Bucket(auth, endpoint, bucket_name)


def _parse_key(key: str):
    """quarantine/{tenant}/{material}/{attempt}/{uuid}.pdf -> phần tương đối + id nếu đúng mẫu P2-05."""
    m = KEY_PATTERN.match(key)
    if not m or ".." in key:
        return None
    rel = m.group("rel")
    parts = rel.split("/")
    ids = {}
    if len(parts) == 4:
        ids = {"tenantId": parts[0], "materialId": parts[1], "attempt": parts[2], "objectUuid": parts[3]}
    return rel, ids


def _sign(key_hex: str, timestamp: str, body: bytes) -> str:
    return hmac.new(bytes.fromhex(key_hex), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def _callback(result: dict, correlation_id: str, fc_request_id: str) -> dict:
    url = os.environ.get("CALLBACK_URL", "").strip()
    if not url:
        log(stage="callback", outcome="skipped_no_url", correlationId=correlation_id, fcRequestId=fc_request_id)
        return {"outcome": "skipped_no_url"}
    if not url.startswith("https://"):
        log(stage="callback", outcome="refused_non_https", correlationId=correlation_id)
        return {"outcome": "refused_non_https"}

    key_id = os.environ.get("CALLBACK_HMAC_KEY_ID", "")
    key_hex = os.environ.get("CALLBACK_HMAC_KEY", "")
    if not key_id or len(key_hex) < 64:
        log(stage="callback", outcome="missing_hmac_config", correlationId=correlation_id)
        return {"outcome": "missing_hmac_config"}

    body = json.dumps(result, separators=(",", ":"), sort_keys=True).encode()
    max_attempts = int(os.environ.get("CALLBACK_MAX_ATTEMPTS", "5"))
    delay = 1.0
    for attempt in range(1, max_attempts + 1):
        ts = str(int(time.time()))
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Content-Type": "application/json",
            "X-EduCenter-Key-Id": key_id,
            "X-EduCenter-Timestamp": ts,
            "X-EduCenter-Signature": _sign(key_hex, ts, body),
            "X-Correlation-Id": correlation_id,
        })
        t0 = time.monotonic()
        status, err = None, None
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                status = resp.status
        except urllib.error.HTTPError as e:
            status = e.code
        except Exception as e:  # lỗi mạng, TLS, timeout
            err = type(e).__name__
        duration_ms = round((time.monotonic() - t0) * 1000, 1)
        # Dòng này là số đo chặng FC -> Azure (6B của hướng dẫn)
        log(stage="callback", metric="fc_to_azure", attempt=attempt, httpStatus=status, error=err,
            durationMs=duration_ms, correlationId=correlation_id, fcRequestId=fc_request_id,
            host=urllib.parse.urlsplit(url).hostname)
        if status is not None and 200 <= status < 300:
            return {"outcome": "delivered", "httpStatus": status, "attempts": attempt}
        if status is not None and 400 <= status < 500:
            return {"outcome": "rejected_4xx", "httpStatus": status, "attempts": attempt}  # không retry 4xx
        if attempt < max_attempts:
            time.sleep(delay)
            delay = min(delay * 2, 8.0)
    return {"outcome": "gave_up", "attempts": max_attempts}


def _process_record(record: dict, context) -> dict:
    fc_request_id = getattr(context, "request_id", "")
    oss_part = record.get("oss", {})
    bucket_name = oss_part.get("bucket", {}).get("name", "")
    obj = oss_part.get("object", {})
    key = obj.get("key", "")
    if "%" in key:
        key = urllib.parse.unquote(key)  # gitleaks:allow
    version_id = _find_ci(obj, "versionId", "versionid", "version-id")
    event_name = record.get("eventName", "")

    # Ghi lại cấu trúc event (chỉ tên trường, không có nội dung nhạy cảm) để kiểm blocker A-04
    log(stage="event", eventName=event_name, bucket=bucket_name, key=key, versionId=version_id,
        objectFields=sorted(obj.keys()), sizeInEvent=obj.get("size"), fcRequestId=fc_request_id)

    parsed = _parse_key(key)
    if not parsed:
        log(stage="skip", reason="key_outside_contract", key=key, fcRequestId=fc_request_id)  # gitleaks:allow
        return {"status": "SKIPPED", "reason": "key_outside_contract"}
    rel, ids = parsed

    require_version = os.environ.get("REQUIRE_VERSION_ID", "true").lower() != "false"
    if not version_id and require_version:
        log(stage="blocked", reason="missing_version_id_in_event", key=key, fcRequestId=fc_request_id)  # gitleaks:allow
        return {"status": FAILED, "reason": "missing_version_id_in_event"}

    started = time.monotonic()
    src = _oss_bucket(context, bucket_name)
    params = {"versionId": version_id} if version_id else None
    head = src.head_object(key, params=params)
    correlation_id = head.headers.get("x-oss-meta-correlation-id") or f"fc-{uuid.uuid4()}"
    size = head.content_length or 0

    if size > 10 * 1024 * 1024:
        # Không tải tệp quá lớn vào bộ nhớ (thường OSS đã chặn từ PostObject policy)
        verdict = ValidationResult(REJECTED, "too_large", 0, size, "")
        data = b""
    else:
        data = src.get_object(key, params=params).read()
        verdict = validate_pdf(data)

    vtag = SAFE.sub("_", version_id or "noversion")[:120]
    pub = _oss_bucket(context, os.environ["PUBLISHED_BUCKET"])
    published_key = preview_key = None

    if verdict.status == READY:
        try:
            png = render_first_page_png(data)
            preview_key = f"previews/{rel}/{vtag}.png"
            pub.put_object(preview_key, png, headers={"Content-Type": "image/png"})
        except Exception as exc:
            # Không render được -> coi là input không hợp lệ (ghi rõ lý do), không ném lỗi hạ tầng
            verdict.status, verdict.reason = REJECTED, "render_failed"
            log(stage="render", outcome="error", errorType=type(exc).__name__, correlationId=correlation_id)
        if verdict.status == READY:
            published_key = f"published/{rel}/{vtag}.pdf"
            pub.put_object(published_key, data, headers={"Content-Type": "application/pdf"})

    duration_ms = round((time.monotonic() - started) * 1000, 1)
    result = {
        "schemaVersion": 1,
        "eventId": f"{fc_request_id}:{vtag}",
        "correlationId": correlation_id,
        "status": verdict.status,
        "reason": verdict.reason,
        **ids,
        "source": {"bucket": bucket_name, "key": key, "versionId": version_id, "eventName": event_name},
        "sizeBytes": verdict.size_bytes,
        "sha256": verdict.sha256,
        "pageCount": verdict.page_count,
        "publishedKey": published_key,  # gitleaks:allow
        "previewKey": preview_key,
        "processingMs": duration_ms,
        "processedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fcRequestId": fc_request_id,
    }
    result_key = f"results/{rel}/{vtag}.json"
    # results/ ghi TRƯỚC callback để reconcile được khi callback mất (P2-09)
    pub.put_object(result_key, json.dumps(result, ensure_ascii=False, indent=2).encode(),
                   headers={"Content-Type": "application/json"})
    log(stage="processed", status=verdict.status, reason=verdict.reason, pages=verdict.page_count,
        sizeBytes=verdict.size_bytes, processingMs=duration_ms, resultKey=result_key,
        correlationId=correlation_id, fcRequestId=fc_request_id)

    cb = _callback(result, correlation_id, fc_request_id)
    return {"status": verdict.status, "reason": verdict.reason, "correlationId": correlation_id, "callback": cb}


def handler(event, context):
    payload = json.loads(event)
    records = payload.get("events", [])
    outcomes = []
    for record in records:
        try:
            outcomes.append(_process_record(record, context))
        except Exception as exc:
            # Lỗi hạ tầng (OSS, quyền, thiếu biến môi trường) -> FAILED và ném lại để FC ghi lỗi/thử lại.
            log(stage="error", status=FAILED, errorType=type(exc).__name__, error=str(exc)[:300],
                fcRequestId=getattr(context, "request_id", ""))
            raise
    return json.dumps(outcomes)
