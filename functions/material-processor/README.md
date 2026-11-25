# material-processor (Function Compute 3.0, Python 3.10)

Worker duy nhất của luồng học liệu. Hợp đồng chung với API: key OSS (`keys.py` ↔ `storage.types.ts`),
kết quả `educenter.material-result/v1` và chữ ký `X-Edu-*` (`callback.py` ↔ `hmac.ts`).

| File | Vai trò |
|---|---|
| `index.py` | handler `index.handler`: đọc đúng `versionId` trong event (thiếu → không xử lý), ghi `published/`, `previews/`, `results/` (results trước callback), callback HTTPS + HMAC, log JSON |
| `processor.py` | kiểm tra PDF (`pypdf`), render trang 1 (`pypdfium2`). Không phải quét mã độc |
| `keys.py`, `callback.py` | bố cục key, ký và gửi callback |
| `s.yaml` | deploy bằng Serverless Devs (`scripts/windows/deploy-aliyun.ps1`) |
| `build.ps1` | đóng gói zip để tải lên console |

Runtime **python3.10** (Debian 10, glibc 2.28). Không chọn 3.12 vì tài liệu FC (cập nhật 26/10/2026) ghi 3.12 đang
*public preview* và danh sách region hỗ trợ không có Singapore. `oss2` có sẵn trong runtime (2.16.0) nên không đóng gói.

Biến môi trường: `OSS_ENDPOINT`, `QUARANTINE_BUCKET`, `PUBLISHED_BUCKET`, `CALLBACK_URL` (https),
`CALLBACK_HMAC_KEY_ID`, `CALLBACK_HMAC_SECRET`, `MAX_BYTES`, `MAX_PAGES`, `PYTHONPATH=/code/python` (chỉ khi deploy bằng `s.yaml`).
`REQUIRE_VERSION_ID=false` và `ALLOW_INSECURE_CALLBACK=true` chỉ để chẩn đoán/mô phỏng, không đặt trên cloud.

Test: `python -m pytest -q tests` (gate trong `test-local.ps1`). Mô phỏng cả luồng với API đang chạy:
`powershell -ExecutionPolicy Bypass -File tests\e2e\fc-sim\run.ps1`. **Chưa chạy trên Alibaba Cloud thật.**
