# Tích hợp Alibaba Cloud

Trạng thái: mã, cấu hình và script đã viết; logic Function Compute đã kiểm thử (15 test, Python 3.12 trong Docker);
**chưa triển khai lên tài khoản thật**.

## OSS
- Hai bucket **private**, versioning bật: `<prefix>-quarantine-<id>` (nhận upload) và `<prefix>-published-<id>`.
- Upload trực tiếp từ trình duyệt bằng **PostObject policy chữ ký V4** (`oss-storage.provider.ts`): key cố định,
  `content-length-range 1..10MB`, `Content-Type=application/pdf`, metadata `tenant-id/material-id/correlation-id/attempt`, hết hạn 5 phút.
- Tải về: signed URL V4 120 giây (`response-content-disposition` inline/attachment).
- Lifecycle (`infra/aliyun/oss/*.xml`): quarantine xóa sau 7 ngày, phiên bản cũ 3 ngày; published giữ phiên bản cũ 30 ngày,
  `results/` 90 ngày; hủy multipart dở sau 1 ngày. CORS chỉ cho `APP_ORIGIN`.
- Key layout: `tenants/<tenant>/materials/<material>/source.pdf|document.pdf|preview.png`, `results/<tenant>/<material>.json`.
- Xóa tài liệu: DB → DELETED, rồi xóa object (versioning giữ bản cũ theo lifecycle).

## RAM (least privilege, không dùng root)
| Danh tính | Quyền | Dùng bởi |
|---|---|---|
| Role `educenter-fc-processor-role` (trust `fc.aliyuncs.com`) | Get quarantine `tenants/*`; Put/Get published `tenants/*`, `results/*`; ghi SLS logstore | Function Compute (STS) |
| User `educenter-api` | Put/Get/Head/Delete/List trên 2 bucket, Get bucket info/versioning/lifecycle | API (ký policy/URL) — key lưu Key Vault |
| User `educenter-ops-readonly` | `AliyunLogReadOnlyAccess`, `AliyunCloudMonitorReadOnlyAccess`, `AliyunBSSReadOnlyAccess` | Dashboard Cloud |
| Profile quản trị RAM | tạo tài nguyên khi deploy | người vận hành (MFA) |

Audit truy cập: ActionTrail (khuyến nghị bật trong console; chưa tự động hóa).

## Function Compute `material-processor`
`functions/material-processor/` — `index.py` (handler), `processor.py` (pypdf + pypdfium2 + Pillow), `callback.py`.
1. Nhận event `ObjectCreated` (PostObject/PutObject/CopyObject, prefix `tenants/`, suffix `/source.pdf`).
2. Chỉ chấp nhận key đúng mẫu và metadata `material-id` khớp.
3. **Idempotency:** nếu `results/…json` đã có cho cùng `versionId` → gửi lại kết quả cũ (cùng `eventId`).
4. Đọc theo `versionId`; kiểm tra dung lượng, chữ ký `%PDF-`, `%%EOF`, mã hóa, số trang (≤ 500), metadata; render trang 1 → PNG ≤ 1200px.
5. Ghi `document.pdf`, `preview.png`, rồi `results/…json`; callback HMAC (retry 0/1/3/8 s, 4xx không retry).
6. Callback thất bại → raise để FC retry bất đồng bộ (tối đa 2) — và reconciler phía Azure vẫn đọc được result JSON.
- Cấu hình (`s.yaml`): Python 3.12, 1 vCPU/1024 MB, timeout 120 s, concurrency 1, endpoint OSS nội bộ.
- Build: wheels Linux bằng `pip install -t python` trong container `python:3.12-slim`; deploy bằng Serverless Devs (`s deploy`).

## SLS
Log JSON một dòng/sự kiện, có `requestId`, `correlationId`, `materialId`, `event`, `level`, `durationMs`
(`processing.started|ready|rejected`, `callback.response|retry|gave_up`, `result.reused`, `preview.failed`).
Project/logstore tạo trong console (hoặc CLI) trước khi deploy. API truy vấn bằng GetLogs (chữ ký SLS — có unit test).

## CloudMonitor
FC request/instance metrics bật trong `logConfig`. API đọc `DescribeMetricList` (namespace `acs_fc`) và
`DescribeMetricRuleList`; chữ ký RPC v1 được kiểm chứng bằng vector tham chiếu của Alibaba. Tên metric FC 3.0
(`FunctionTotalInvocations`, `FunctionErrorInvocations`, `FunctionLatencyAvg`) **cần xác nhận** khi có tài khoản.
Alarm rule (lỗi > 0, độ trễ > 30 s) tạo trong console.
