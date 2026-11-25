# material-processor (Function Compute 3.0, Python 3.10)

Bản PoC/hardening phía cloud do Giang chuẩn bị (P0-15, P2-08). Người sở hữu logic xử lý PDF cuối cùng: **chờ Đức chốt**.

- `validator.py` — kiểm magic bytes, ≤10 MB, mã hóa, số trang (`pypdf`), render trang 1 (`pypdfium2`). Không phải quét mã độc.
- `index.py` — handler `index.handler`: đọc đúng `versionId` trong event (thiếu → FAILED, không đọc bản mới nhất), ghi `published/`, `previews/`, `results/` (results trước callback), callback HTTPS + HMAC, retry ≤5 chỉ với lỗi mạng/5xx, log JSON theo `correlationId`.
- `tests/` — `python -m pytest -q` (9 ca).
- `build.ps1` — đóng gói zip cho Linux x86_64 từ Windows.

Định dạng chữ ký callback là đề xuất; phải khớp contract `POST /api/v1/internal/material-events` (P0-16) của Anh/Hà trước khi bật `CALLBACK_URL`.
