"""pytest cho validator (P0-15 yêu cầu >= 6 ca). Chạy: python -m pytest -q"""
import io
import os
import sys

import pytest
from pypdf import PdfWriter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from validator import READY, REJECTED, render_first_page_png, validate_pdf  # noqa: E402


def make_pdf(pages: int = 1, password: str | None = None) -> bytes:
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)  # A4 theo point
    if password:
        w.encrypt(password)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def test_01_valid_pdf_ready():
    r = validate_pdf(make_pdf(3))
    assert r.status == READY and r.page_count == 3 and len(r.sha256) == 64


def test_02_empty_file_rejected():
    assert validate_pdf(b"").reason == "empty_file"


def test_03_text_renamed_to_pdf_rejected():
    r = validate_pdf("Day la file van ban doi duoi thanh .pdf\n".encode() * 50)
    assert r.status == REJECTED and r.reason == "not_pdf_magic"


def test_04_too_large_rejected():
    data = make_pdf(1)
    r = validate_pdf(data, max_bytes=len(data) - 1)
    assert r.status == REJECTED and r.reason == "too_large"


def test_05_truncated_pdf_rejected():
    data = make_pdf(2)
    r = validate_pdf(data[: len(data) // 3])
    assert r.status == REJECTED


def test_06_encrypted_pdf_rejected():
    r = validate_pdf(make_pdf(1, password="secret-test"))
    assert r.status == REJECTED and r.reason == "encrypted_pdf"


def test_07_too_many_pages_rejected():
    r = validate_pdf(make_pdf(5), max_pages=4)
    assert r.status == REJECTED and r.reason == "too_many_pages" and r.page_count == 5


def test_08_magic_only_garbage_rejected():
    r = validate_pdf(b"%PDF-1.7\n" + os.urandom(2048))
    assert r.status == REJECTED


def test_09_render_first_page_png():
    png = render_first_page_png(make_pdf(1))
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
