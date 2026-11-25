"""Tạo dữ liệu kiểm thử TỔNG HỢP (không dữ liệu thật) cho P0-15/P0-18.

Chạy:  python tools\\poc\\make_test_files.py --out %USERPROFILE%\\EduCenter-Giang\\testdata
Tạo:
  valid-1page.pdf        PDF nhỏ hợp lệ
  valid-2mb.pdf          PDF ~2 MB (ảnh nhiễu) cho tiêu chí "2 MB < 60 giây"
  fake-text.pdf          tệp văn bản đổi đuôi .pdf -> phải REJECTED
  truncated.pdf          PDF bị cắt cụt -> phải REJECTED
  too-big-11mb.pdf       11 MB -> OSS phải từ chối ngay ở PostObject (content-length-range)
"""
import argparse
import io
import os

from PIL import Image
from pypdf import PdfWriter


def noise_pdf(target_bytes: int) -> bytes:
    pages, size = [], 0
    while size < target_bytes:
        img = Image.frombytes("RGB", (900, 1270), os.urandom(900 * 1270 * 3))
        pages.append(img)
        buf = io.BytesIO()
        pages[0].save(buf, format="PDF", save_all=True, append_images=pages[1:], quality=85)
        size = buf.tell()
    return buf.getvalue()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    out = p.parse_args().out
    os.makedirs(out, exist_ok=True)

    w = PdfWriter()
    w.add_blank_page(width=595, height=842)
    w.add_metadata({"/Title": "EduCenter - tai lieu mau (du lieu tong hop)"})
    b = io.BytesIO()
    w.write(b)
    small = b.getvalue()

    files = {
        "valid-1page.pdf": small,
        "valid-2mb.pdf": noise_pdf(2 * 1024 * 1024),
        "fake-text.pdf": ("Day la tep van ban gia, doi duoi thanh .pdf de thu REJECTED.\n" * 40).encode(),
        "truncated.pdf": small[: len(small) // 3],
        "too-big-11mb.pdf": b"%PDF-1.7\n" + os.urandom(11 * 1024 * 1024),
    }
    for name, data in files.items():
        path = os.path.join(out, name)
        with open(path, "wb") as f:
            f.write(data)
        print(f"{name:20s} {len(data):>10,d} bytes")


if __name__ == "__main__":
    main()
