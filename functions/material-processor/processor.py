"""PDF validation, metadata extraction and preview rendering (no cloud I/O — unit-testable).

Libraries (ROADMAP D-10, permissive licences): pypdf (BSD) for structure/metadata,
pypdfium2 (Apache-2.0/BSD) for rendering the first page, Pillow for PNG encoding.
Magic-byte and structure checks are NOT malware scanning (D-11).
"""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from typing import Optional

MAX_PREVIEW_WIDTH = 1200


@dataclass
class Accepted:
    page_count: int
    title: Optional[str]
    author: Optional[str]
    sha256: str
    size_bytes: int
    preview_png: Optional[bytes]
    preview_error: Optional[str] = None


@dataclass
class Rejected:
    code: str
    message: str


def _clean(value: object) -> Optional[str]:
    if value is None:
        return None
    text = "".join(ch for ch in str(value) if ch >= " ").strip()
    return text[:300] or None


def render_preview(data: bytes) -> bytes:
    """Renders page 1 to PNG, at most MAX_PREVIEW_WIDTH pixels wide."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    try:
        page = pdf[0]
        width_pt = page.get_width()
        scale = min(2.0, MAX_PREVIEW_WIDTH / max(width_pt, 1))
        image = page.render(scale=scale).to_pil()
        out = io.BytesIO()
        image.save(out, format="PNG", optimize=True)
        return out.getvalue()
    finally:
        pdf.close()


def process_pdf(data: bytes, max_bytes: int, max_pages: int, with_preview: bool = True):
    """Returns Accepted or Rejected. Never raises for bad input; unexpected errors propagate."""
    if not data:
        return Rejected("EMPTY", "Tệp rỗng")
    if len(data) > max_bytes:
        return Rejected("TOO_LARGE", f"Tệp vượt quá {max_bytes // (1024 * 1024)} MB")
    if b"%PDF-" not in data[:1024]:
        return Rejected("NOT_PDF", "Không phải tệp PDF (thiếu chữ ký %PDF-)")
    if b"%%EOF" not in data[-2048:]:
        return Rejected("CORRUPT", "Tệp PDF bị cắt hoặc hỏng (thiếu %%EOF)")

    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            return Rejected("ENCRYPTED", "PDF được mã hóa/đặt mật khẩu — không thể xử lý")
        page_count = len(reader.pages)
        meta = reader.metadata
    except PdfReadError:
        return Rejected("CORRUPT", "Không đọc được cấu trúc PDF")
    except Exception:  # pypdf raises assorted errors on malformed input
        return Rejected("CORRUPT", "Không đọc được cấu trúc PDF")

    if page_count < 1:
        return Rejected("CORRUPT", "PDF không có trang nào")
    if page_count > max_pages:
        return Rejected("TOO_MANY_PAGES", f"PDF có {page_count} trang, vượt giới hạn {max_pages}")

    preview, preview_error = None, None
    if with_preview:
        try:
            preview = render_preview(data)
        except Exception as exc:  # preview is best effort; the document is still valid
            preview_error = type(exc).__name__

    return Accepted(
        page_count=page_count,
        title=_clean(meta.title) if meta else None,
        author=_clean(meta.author) if meta else None,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        preview_png=preview,
        preview_error=preview_error,
    )
