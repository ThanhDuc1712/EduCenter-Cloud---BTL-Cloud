"""Kiểm tra tệp PDF đầu vào cho EduCenter (P0-15 / P2-08).

Hàm ở đây không gọi mạng và không phụ thuộc Function Compute,
để chạy pytest trên máy Windows của người phát triển.
Lưu ý: đây là kiểm tra cấu trúc PDF, KHÔNG phải quét mã độc.
"""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass, field

MAX_BYTES = 10 * 1024 * 1024  # 10 MB, khớp content-length-range của PostObject (D-21)
MAX_PAGES = 300
PDF_MAGIC = b"%PDF-"
MAGIC_SEARCH_WINDOW = 1024  # đặc tả PDF cho phép header nằm trong 1024 byte đầu

READY = "READY"
REJECTED = "REJECTED"


@dataclass
class ValidationResult:
    status: str  # READY hoặc REJECTED (lỗi hạ tầng là FAILED, xử lý ở index.py)
    reason: str = ""
    page_count: int = 0
    size_bytes: int = 0
    sha256: str = ""
    extra: dict = field(default_factory=dict)


def validate_pdf(data: bytes, max_bytes: int = MAX_BYTES, max_pages: int = MAX_PAGES) -> ValidationResult:
    size = len(data)
    digest = hashlib.sha256(data).hexdigest() if data else ""

    def rejected(reason: str) -> ValidationResult:
        return ValidationResult(REJECTED, reason, 0, size, digest)

    if size == 0:
        return rejected("empty_file")
    if size > max_bytes:
        return rejected("too_large")
    if PDF_MAGIC not in data[:MAGIC_SEARCH_WINDOW]:
        return rejected("not_pdf_magic")

    try:
        from pypdf import PdfReader  # import muộn để lỗi thiếu thư viện hiện rõ ở log

        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            return rejected("encrypted_pdf")
        pages = len(reader.pages)
    except Exception as exc:  # pypdf ném nhiều loại lỗi khác nhau với PDF hỏng
        res = rejected("pdf_parse_error")
        res.extra["error_type"] = type(exc).__name__
        return res

    if pages <= 0:
        return rejected("no_pages")
    if pages > max_pages:
        r = rejected("too_many_pages")
        r.page_count = pages
        return r

    return ValidationResult(READY, "", pages, size, digest)


def render_first_page_png(data: bytes, max_width_px: int = 1024) -> bytes:
    """Render trang 1 ra PNG bằng pypdfium2. Ném exception nếu không render được."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    try:
        page = pdf[0]
        try:
            width_pt, _height_pt = page.get_size()
            scale = min(2.0, max_width_px / width_pt) if width_pt > 0 else 1.0
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
            out = io.BytesIO()
            image.save(out, format="PNG", optimize=True)
            return out.getvalue()
        finally:
            page.close()
    finally:
        pdf.close()
