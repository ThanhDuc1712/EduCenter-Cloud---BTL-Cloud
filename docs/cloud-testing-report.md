# Báo cáo kiểm thử

Ngày chạy: 2026-11-24 · Windows 11, PowerShell 5.1, Node 24.22.3, pnpm 10.34.9, Docker 29.9.3, PostgreSQL 16 (Docker).
Chỉ ghi PASS cho những gì **đã chạy**. Báo cáo này (24/11) là kiểm thử local. Kết quả trên **Azure thật** (25–28/11) nằm ở `docs/evidence/qa/*-azure` và `completion-report.md`. Alibaba Cloud thật: **BLOCKED** (tài khoản bị kiểm soát rủi ro).

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

---

## Bổ sung 2026-11-25 — kiểm thử bản tích hợp FE/BE + cloud

Các số liệu ở trên là của nhánh FE/BE trước khi tích hợp. Phần này chạy trên bản đã gộp (Windows 11, Node 24, Docker).

### Đã chạy local

| Kiểm thử | Kết quả |
|---|---|
| `test-local.ps1` (build, lint, typecheck, unit, build, integration PostgreSQL, worker Python 3.10, E2E) | PASS cả 8 gate |
| `tests/e2e/integration-flow.mjs` (LOCAL MODE) | PASS — 27/27 |
| `tests/e2e/fc-sim/run.ps1`: material → key OSS → handler thật của worker → callback HMAC qua HTTP → đúng material; sai secret; mất callback + đối soát; retry sang lần 2 | PASS — 33/33, **OSS và Function Compute được mô phỏng** |
| Gói worker từ `build.ps1`: import + render trên Debian 10 / glibc 2.28 / Python 3.10 | PASS |
| `az bicep build`, `lint`, `build-params` (chỉ validate) | PASS |
| `bootstrap_db.py` (Key Vault giả lập) + migration bằng `edu_migrator` trên PostgreSQL 16 với admin không phải superuser | PASS — 26 bảng, `edu_runtime` đọc được tất cả |
| Gói `deploy-azure.ps1 -PackageOnly` chạy trong container Linux Node 24 chỉ với app settings trong `main.bicep` (chế độ local và chế độ OSS) | PASS |

### Chưa chạy trên cloud thật

- Azure: template đã bổ sung app settings **chưa deploy** (chỉ validate); `deploy-azure.ps1` chưa chạy với subscription;
  Key Vault reference, TLS tới PostgreSQL và App Service startup của bản mới chưa kiểm.
- Alibaba Cloud: chưa có gì chạy thật — OSS, PostObject, trigger (kể cả việc event có `versionId`, giả định A-04),
  RAM policy, lifecycle, Function Compute, SLS. `deploy-aliyun.ps1` chưa chạy.
- Chưa đo hiệu năng.

---

## Bổ sung 2026-11-28: Azure thật (East Asia)

Người thực hiện phần hạ tầng: Ngô Minh Giang. Kiểm thử chức năng/bảo mật: Hòa Tùng Dương (`docs/evidence/qa/*-azure`).
Môi trường: App Service B1 Linux (Node 24), PostgreSQL Flexible B1ms (PG16, TLS), 2 Key Vault (RBAC), Application Insights + Log Analytics,
resource group `rg-educenter-demo`, vùng `eastasia` (Azure for Students không cho `southeastasia`).

| Hạng mục | Kết quả | Thời điểm / bản |
|---|---|---|
| Bicep `infra/azure/main.bicep` | PASS: deploy Succeeded (lần đầu F1 lỗi `Conflict 03029`, chạy lại idempotent) | 25/11 |
| Role DB `edu_migrator` / `edu_runtime`, firewall theo IP outbound, không mở 0.0.0.0 | PASS | 25/11 |
| Migration (`prisma migrate deploy` bằng `edu_migrator`) | PASS: 2/2 | 25/11 |
| Key Vault references (`DATABASE_URL`, `DEMO_CONTEXT_SECRET`, `CALLBACK_HMAC_KEYS`) qua Managed Identity | PASS: Resolved | 25/11 |
| CI/CD GitHub Actions → Azure (OIDC, không có secret dài hạn) | PASS: Deploy #2, #3, #5 xanh; #1 lỗi `AADSTS700213` (subject OIDC có ID) → thêm federated credential | 27–28/11 |
| Health `/api/v1/health` | PASS: `{"status":"ok","checks":{"app":"up","database":"up"}}` | 25–28/11 |
| Luồng học liệu F09 (LOCAL MOCK FC trên Azure) | PASS: PDF hợp lệ → READY (1 trang, xử lý 1,7 s, callback 255 ms); tệp giả → REJECTED; tải bằng signed GET 200, tệp REJECTED → 422 | 27/11, `10dac2f` |
| QA azure-final (Dương) | PASS: security 26/0, authz matrix PASS, E2E 34/34, k6 smoke PASS | 28/11 14:23, `ce99a00` |
| Số liệu vận hành (trang Cloud Monitoring, 60 phút) | API p95 216 ms (TB 58 ms, 1.063 request, 0% 5xx); DB ping 11 ms | 28/11 14:38 |
| Azure Monitor | CONFIGURED: 3 metric alert (Http5xx, HealthCheckStatus, PG storage) → action group email; chưa có lần kích hoạt thật; gửi thử bị chặn trên offer sinh viên | 26/11 |
| PITR PostgreSQL | PASS: restore Succeeded về thời điểm −15 phút, RTO ≈ 80–90 phút (thời gian chờ lệnh), server tạm đã xóa | 26–27/11 |
| Lỗi chỉ lộ ra trên Azure, đã sửa | IP client kèm cổng sau proxy App Service (403 `/cloud/*`, giới hạn IP vô hiệu); biến `false` bị đọc thành `true` (`REGISTRATION_ENABLED`) | 27–28/11 |
| Alibaba Cloud | BLOCKED: kiểm soát rủi ro tài khoản (FC 25/11, OSS 26/11), KYC bị từ chối 27/11 | |

