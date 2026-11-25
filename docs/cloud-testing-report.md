# Báo cáo kiểm thử

Ngày chạy: 2026-11-24 · Windows 11, PowerShell 5.1, Node 24.22.3, pnpm 10.34.9, Docker 29.9.3, PostgreSQL 16 (Docker).
Chỉ ghi PASS cho những gì **đã chạy**. Không có kiểm thử nào chạy trên Azure hay Alibaba Cloud thật.

## Cổng chất lượng — `scripts/windows/test-local.ps1`

| Gate | Kết quả |
|---|---|
| Build shared package | PASS |
| Lint (ESLint API + web, Redocly OpenAPI) | PASS (web còn 2 cảnh báo `react-hooks/incompatible-library` do `react-hook-form.watch`) |
| Typecheck (api, web, packages) | PASS |
| Unit tests API (Jest) | PASS — 6 suites, 51 tests |
| Build (shared, contract, api, web) | PASS (cảnh báo: bundle web 830 KB chưa code-split) |
| Integration tests (PostgreSQL thật, role `edu_runtime`) | PASS — 2 suites, 11 tests |
| Function Compute tests (pytest, `python:3.12-slim` trong Docker) | PASS — 15 tests |
| E2E integration flow (`tests/e2e/integration-flow.mjs`, API đang chạy) | PASS — 27/27 checks |

## Nội dung kiểm thử chính

**Unit (API):** HMAC (đúng key, xoay 2 key, body bị sửa, key lạ, thiếu header, timestamp cũ/tương lai, chữ ký chéo key,
vector chung với Python); máy trạng thái tài liệu; hợp đồng result JSON; kiểm tra PDF (hợp lệ/không phải PDF/rỗng/cắt cụt/quá
dung lượng, preview 1 trang); token ký local (hết hạn, giả mạo); thời gian VN và sinh buổi học; chồng giờ; điểm TB có trọng số và
xếp loại; tỷ lệ chuyên cần; trạng thái hóa đơn; CSV (BOM, quote, formula injection); chữ ký RPC Alibaba (**khớp vector tham chiếu
chính thức**) và chữ ký SLS; cấu hình env; bộ lọc lỗi; nền tảng HTTP; mọi route có chính sách truy cập.

**Integration (DB thật):** cách ly tenant (API 404 + FK tổng hợp từ chối liên kết chéo); `tenantId`/`role` trong body bị từ chối;
phạm vi giáo viên/học viên; học viên không xem hóa đơn người khác; thanh toán idempotent (replay cùng key, key dùng lại → 409,
thiếu key → 400, vượt nợ → 422, thanh toán đủ → PAID); sức chứa đúng dưới 5 yêu cầu ghi danh đồng thời; khóa lạc quan điểm
(version cũ → 409), điểm ngoài thang → 400, giáo viên khác → 403; runtime không sửa được `activity_logs` / xóa `payments`;
health + role không superuser + không DDL.

**FC (Python):** vector HMAC chung; retry 5xx / không retry 4xx; PDF hợp lệ → metadata + PNG; từ chối rỗng / không phải PDF /
cắt cụt / mã hóa / quá dung lượng / quá số trang; handler ghi document + preview + result và callback; non-PDF → REJECTED;
idempotent cùng version (cùng eventId); bỏ qua key lạ & metadata sai; callback lỗi → raise (FC retry) nhưng vẫn lưu result; parse event OSS.

**E2E (luồng ưu tiên giáo dục + cloud, LOCAL MODE):** tạo khóa học → lớp + thời khóa biểu (sinh buổi) → chặn trùng lịch giáo viên →
tạo học viên → ghi danh (tự tạo hóa đơn) → chặn ghi danh trùng → tạo tài liệu + upload policy → upload trực tiếp vào quarantine →
xác nhận → xử lý → **callback HMAC thật** → READY (3 trang, có preview) → học viên đã ghi danh thấy tài liệu trong khóa học →
preview qua signed URL → tải xuống trùng khớp byte → URL bị sửa bị từ chối → học viên không upload được → activity ghi nhận
ghi danh/upload/download → job có correlation ID → ops log theo correlation ID qua ≥ 3 dịch vụ → telemetry độ trễ callback + API →
tệp không phải PDF → REJECTED → callback giả mạo → 401 → loại tệp không phải PDF bị từ chối trước khi upload.

**Kiểm tra thủ công trên trình duyệt (Chrome):** Dashboard, Lớp học, Lịch học (tuần), Điểm số, Học phí, Cloud Architecture,
xem trước tài liệu (iframe same-origin dưới CSP), chuyển persona sang học viên (menu thu gọn, dashboard cá nhân); không có lỗi console.

**Gói triển khai Azure (production, local):** `deploy-azure.ps1 -PackageOnly` → zip 145 MB; chạy `NODE_ENV=production`:
`/` và deep link trả SPA, `/api/v1/*` không tồn tại → 404, `/api/v1/cloud/overview` → **403** khi không có `OPS_ALLOWED_CIDRS`.

**Sao lưu/khôi phục (local):** `pg_dump -Fc` → `pg_restore` vào DB mới → số dòng students/class_sessions/payments/materials trùng khớp (129/352/153/6).

## Lỗi phát hiện nhờ kiểm thử và đã sửa
1. Tạo học viên đồng thời sinh trùng mã tự động → khóa `pg_advisory_xact_lock` cho HV/GV/HD.
2. SPA fallback trả 500 khi đường dẫn có thư mục bắt đầu bằng dấu chấm → `sendFile` với `root`.
3. Tệp asset thiếu trả `index.html` → bỏ qua fallback cho đường dẫn có phần mở rộng.
4. API khởi động ~10 s do nạp OpenTelemetry khi không cấu hình → nạp có điều kiện (1,6 s).
5. Jest nạp nhầm mã nguồn `.ts` của `ali-oss` → ưu tiên `.js`.
6. Script PowerShell 5.1 lỗi cú pháp với ký tự không ASCII; một tệp TSX bị hỏng mã hóa khi ghi bằng PowerShell → đã khôi phục.
7. E2E không chạy lại được (trùng khung giờ với lần chạy trước) → khung giờ duy nhất mỗi lần chạy.

## Chưa kiểm thử (NOT VERIFIED)
OSS upload/download thật, trigger Function Compute thật, SLS, CloudMonitor, Key Vault/Managed Identity, Application Insights,
Azure Monitor, PostgreSQL Flexible (TLS/PITR), biên dịch Bicep (`az bicep build`), `deploy-azure.ps1`/`deploy-aliyun.ps1` trên tài khoản thật,
tải/hiệu năng. Lý do: không có credential cloud và không cài Azure CLI/Aliyun CLI trong môi trường phát triển.
Ghi chú: cảnh báo `pg` "client.query() when the client is already executing" xuất phát từ bên trong Prisma 7.10 (adapter-pg), kết quả vẫn đúng.
