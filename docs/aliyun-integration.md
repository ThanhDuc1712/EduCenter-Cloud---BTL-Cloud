# Tích hợp Alibaba Cloud

Trạng thái: mã, cấu hình và script đã viết; worker kiểm thử bằng pytest (Python 3.10 trong Docker) và mô phỏng cả luồng
với API local (`tests/e2e/fc-sim`). **Chưa triển khai lên tài khoản thật** (kích hoạt Function Compute đang bị chặn).

## OSS
- Hai bucket **private**, versioning bật: `<prefix>-quarantine-<id>` (nhận upload) và `<prefix>-published-<id>`.
- Upload trực tiếp từ trình duyệt bằng **PostObject policy chữ ký V4** (`oss-storage.provider.ts`): key cố định,
  `content-length-range 1..10MB`, `Content-Type=application/pdf`, metadata `tenant-id/material-id/correlation-id/attempt`, hết hạn 5 phút.
- Tải về: signed URL V4 120 giây (`response-content-disposition` inline/attachment).
- Lifecycle (`infra/aliyun/oss/*.xml`): quarantine xóa sau 1 ngày (cả phiên bản cũ); `published/`, `previews/` giữ phiên bản cũ 30 ngày,
  `results/` 90 ngày; hủy multipart dở sau 1 ngày. CORS chỉ cho `APP_ORIGIN`.
- Key layout (ROADMAP P2-05): quarantine `quarantine/{tenant}/{material}/{attempt}/{uuid}.pdf`; published
  `published|previews|results/{tenant}/{material}/{attempt}/{versionTag}.{pdf|png|json}`.
- Xóa tài liệu: DB → DELETED, rồi xóa object `published/`, `previews/`; `quarantine/`, `results/` do lifecycle dọn.

## RAM (least privilege, không dùng root)
| Danh tính | Quyền | Dùng bởi |
|---|---|---|
| Role `educenter-fc-worker` (`policy-fc-worker.json`) | Get (kèm version) `quarantine/*`; Put `published/*`, `previews/*`, `results/*`; Get `results/*`; ghi SLS | Function Compute (STS) |
| User `api-storage` (`policy-api-storage.json`) | Put/Get `quarantine/*`; Get/Delete `published/*`, `previews/*`; Get `results/*`; List + xem cấu hình bucket | API — key lưu Key Vault |
| User `educenter-ops-readonly` | `AliyunLogReadOnlyAccess`, `AliyunCloudMonitorReadOnlyAccess`, `AliyunBSSReadOnlyAccess` | Dashboard Cloud |
| Profile quản trị RAM | tạo tài nguyên khi deploy | người vận hành (MFA) |

Audit truy cập: ActionTrail (khuyến nghị bật trong console; chưa tự động hóa).

## Function Compute `material-processor`
`functions/material-processor/` — xem [README](../functions/material-processor/README.md).
1. Nhận event `ObjectCreated` (PostObject, CopyObject; prefix `quarantine/`, suffix `.pdf`).
2. Chỉ chấp nhận key đúng mẫu, metadata `material-id` khớp, và đọc đúng `versionId` trong event.
3. **Idempotency:** đã có `results/…json` của đúng (attempt, version) → gửi lại kết quả cũ (cùng `eventId`).
4. Kiểm tra dung lượng, chữ ký `%PDF-`, `%%EOF`, mã hóa, số trang (≤ 500), metadata; render trang 1 → PNG ≤ 1200px.
5. Ghi `published/`, `previews/`, rồi `results/`; callback HMAC (retry 0/1/3/8 s, 4xx không retry).
6. Callback thất bại → raise để FC retry bất đồng bộ — reconciler phía Azure vẫn đọc được result JSON.
- Cấu hình (`s.yaml`): Python 3.10, 1 vCPU/1024 MB, timeout 120 s, concurrency 1, endpoint OSS nội bộ.
- Build: wheels `manylinux_2_28` cho CPython 3.10; deploy bằng Serverless Devs hoặc `build.ps1` + console.

## SLS
Log JSON một dòng/sự kiện, có `requestId`, `correlationId`, `materialId`, `event`, `level`, `durationMs`
(`processing.started|ready|rejected`, `callback.response|retry|gave_up`, `result.reused`, `preview.failed`).
Project/logstore tạo trong console (hoặc CLI) trước khi deploy. API truy vấn bằng GetLogs (chữ ký SLS — có unit test).

## CloudMonitor
FC request/instance metrics bật trong `logConfig`. API đọc `DescribeMetricList` (namespace `acs_fc`) và
`DescribeMetricRuleList`; chữ ký RPC v1 được kiểm chứng bằng vector tham chiếu của Alibaba. Tên metric FC 3.0
(`FunctionTotalInvocations`, `FunctionErrorInvocations`, `FunctionLatencyAvg`) **cần xác nhận** khi có tài khoản.
Alarm rule (lỗi > 0, độ trễ > 30 s) tạo trong console.
