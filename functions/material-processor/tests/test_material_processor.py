import io
import json
import os
import sys

import pytest
from pypdf import PdfWriter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import callback as cb  # noqa: E402
import index  # noqa: E402
import processor  # noqa: E402

TENANT = "11111111-1111-4111-8111-111111111111"
MATERIAL = "22222222-2222-4222-8222-222222222222"
KEY = f"tenants/{TENANT}/materials/{MATERIAL}/source.pdf"
MB = 1024 * 1024


def make_pdf(pages=3, title="Giáo trình IELTS", encrypt=False) -> bytes:
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)
    w.add_metadata({"/Title": title, "/Author": "EduCenter"})
    if encrypt:
        w.encrypt("secret")
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


# ───── callback signing ─────

def test_signature_matches_typescript_vector():
    # Same vector as apps/api/src/modules/materials/materials-core.spec.ts
    assert cb.compute_signature("test-secret-0123456789abcdef0123456789", "1700000000", b'{"a":1}') == "773367e1dd7d86efbea93b835d6b00ebff0b7da38875d3672436868154633359"


def test_sign_headers_format():
    h = cb.sign_headers("k1", "x" * 32, b"{}", now=1700000000)
    assert h["X-Edu-Key-Id"] == "k1" and h["X-Edu-Timestamp"] == "1700000000"
    assert h["X-Edu-Signature"].startswith("v1=") and len(h["X-Edu-Signature"]) == 67


def test_send_callback_retries_5xx_but_not_4xx():
    calls = []

    def post(url, body, headers, timeout):
        calls.append(headers["X-Edu-Timestamp"])
        return 503 if len(calls) < 3 else 200

    assert cb.send_callback("http://api", "k1", "x" * 32, b"{}", lambda *a, **k: None, post=post, delays=(0, 0, 0, 0))
    assert len(calls) == 3

    calls.clear()
    assert not cb.send_callback("http://api", "k1", "x" * 32, b"{}", lambda *a, **k: None, post=lambda *a: calls.append(1) or 401, delays=(0, 0, 0))
    assert len(calls) == 1


# ───── PDF processing ─────

def test_accepts_valid_pdf_and_renders_png_preview():
    r = processor.process_pdf(make_pdf(4), 10 * MB, 500)
    assert isinstance(r, processor.Accepted)
    assert r.page_count == 4 and r.title == "Giáo trình IELTS" and r.author == "EduCenter"
    assert len(r.sha256) == 64
    assert r.preview_png and r.preview_png[:8] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize(
    "data,code",
    [
        (b"", "EMPTY"),
        (b"not a pdf at all", "NOT_PDF"),
        (make_pdf(1)[:-200], "CORRUPT"),
        (make_pdf(1, encrypt=True), "ENCRYPTED"),
    ],
)
def test_rejects_bad_input(data, code):
    r = processor.process_pdf(data, 10 * MB, 500)
    assert isinstance(r, processor.Rejected) and r.code == code


def test_rejects_size_and_page_limits():
    assert processor.process_pdf(make_pdf(1), 100, 500).code == "TOO_LARGE"
    assert processor.process_pdf(make_pdf(6), 10 * MB, 5).code == "TOO_MANY_PAGES"


# ───── handler (in-memory OSS) ─────

class FakeStorage:
    def __init__(self, source: bytes, version="v1", meta=None):
        self.source, self.version = source, version
        self.meta = meta if meta is not None else {"material-id": MATERIAL, "correlation-id": "mat-22222222-a1-abc123", "attempt": "1"}
        self.published = {}

    def head_source(self, key):
        return {"size": len(self.source), "version_id": self.version, "meta": self.meta} if key == KEY else None

    def get_source(self, key, version_id):
        assert version_id == self.version
        return self.source

    def get_result(self, key):
        return self.published.get(key, (None, None))[0]

    def put_published(self, key, data, content_type):
        self.published[key] = (data, content_type)


SETTINGS = {"callback_url": "https://api.example.test/api/v1/internal/material-callback", "key_id": "k1", "secret": "s" * 40, "max_bytes": 10 * MB, "max_pages": 500}


def collect():
    sent = []

    def send(url, key_id, secret, raw, log):
        sent.append(json.loads(raw))
        return True

    return sent, send


def test_handler_ready_writes_outputs_and_calls_back():
    storage = FakeStorage(make_pdf(2))
    sent, send = collect()
    out = index.process_object(KEY, storage, SETTINGS, "req-1", index.Logger("req-1"), send=send)
    assert out["status"] == "READY"
    doc = f"tenants/{TENANT}/materials/{MATERIAL}/document.pdf"
    assert storage.published[doc][1] == "application/pdf"
    assert storage.published[f"tenants/{TENANT}/materials/{MATERIAL}/preview.png"][1] == "image/png"
    result = json.loads(storage.published[f"results/{TENANT}/{MATERIAL}.json"][0])
    assert result == sent[0]
    assert result["schema"] == "educenter.material-result/v1" and result["processor"] == "ALIYUN_FC"
    assert result["result"]["pageCount"] == 2 and result["result"]["documentKey"] == doc
    assert result["sourceVersionId"] == "v1" and result["correlationId"] == "mat-22222222-a1-abc123"


def test_handler_rejects_non_pdf():
    storage = FakeStorage(b"hello world")
    sent, send = collect()
    assert index.process_object(KEY, storage, SETTINGS, "req-2", index.Logger("req-2"), send=send)["status"] == "REJECTED"
    assert sent[0]["error"]["code"] == "NOT_PDF" and sent[0]["result"] is None


def test_handler_is_idempotent_for_same_version():
    storage = FakeStorage(make_pdf(1))
    sent, send = collect()
    index.process_object(KEY, storage, SETTINGS, "req-3", index.Logger("req-3"), send=send)
    again = index.process_object(KEY, storage, SETTINGS, "req-4", index.Logger("req-4"), send=send)
    assert again.get("reused") is True
    assert sent[0]["eventId"] == sent[1]["eventId"]  # API deduplicates by eventId


def test_handler_ignores_unexpected_keys_and_metadata_mismatch():
    sent, send = collect()
    assert index.process_object("other/file.pdf", FakeStorage(b""), SETTINGS, "r", index.Logger("r"), send=send)["status"] == "IGNORED"
    bad = FakeStorage(make_pdf(1), meta={"material-id": "33333333-3333-4333-8333-333333333333"})
    assert index.process_object(KEY, bad, SETTINGS, "r", index.Logger("r"), send=send)["status"] == "IGNORED"
    assert sent == []


def test_handler_raises_when_callback_fails_so_fc_retries():
    storage = FakeStorage(make_pdf(1))
    with pytest.raises(RuntimeError):
        index.process_object(KEY, storage, SETTINGS, "req-5", index.Logger("req-5"), send=lambda *a: False)
    # Result JSON is stored anyway for the Azure reconciler.
    assert f"results/{TENANT}/{MATERIAL}.json" in storage.published


def test_parse_oss_trigger_event():
    event = json.dumps({"events": [{"eventName": "ObjectCreated:PostObject", "oss": {"bucket": {"name": "q"}, "object": {"key": KEY, "size": 10}}}]}).encode()
    assert index.parse_events(event)[0]["oss"]["object"]["key"] == KEY
