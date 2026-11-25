# Báo cáo hoàn thành

Trạng thái:
- **VERIFIED** — đã chạy và có bằng chứng ([cloud-testing-report.md](cloud-testing-report.md)).
- **IMPLEMENTED** — mã/cấu hình đã viết, type-check/lint/parse đạt, nhưng chưa chạy trên dịch vụ thật.
- **NOT IMPLEMENTED** — chưa làm.

## A. Website Management

| Hạng mục | Trạng thái | Bằng chứng / ghi chú |
|---|---|---|
| Dashboard | VERIFIED | số liệu DB thật theo vai trò; xem trên trình duyệt |
| Student Management | VERIFIED | CRUD, lưu trữ/khôi phục, tìm/lọc/phân trang, chi tiết (lớp, lịch, điểm, điểm danh, học phí); E2E + integration |
| Teacher Management | VERIFIED (API + UI) | CRUD, chuyên môn, lớp phân công, lịch dạy, học viên, trạng thái giảng dạy |
| Course Management | VERIFIED | CRUD, lưu trữ, xóa có điều kiện, học phí, thời lượng, tài liệu, số học viên; E2E |
| Class Management | VERIFIED | CRUD, khóa học, giáo viên, sức chứa, thời khóa biểu, sinh buổi, **chống trùng lịch GV/phòng**; E2E |
| Schedule Management | VERIFIED (UI) | ngày/tuần/tháng, lọc lớp/GV/phòng, quét trùng, chi tiết buổi |
| Enrollment Management | VERIFIED | còn chỗ (đồng thời), chống trùng, hủy, đổi trạng thái; integration |
| Attendance | VERIFIED (API) | 4 trạng thái, cập nhật, lịch sử, tỷ lệ theo lớp/học viên |
| Grades | VERIFIED | bài kiểm tra, nhập/sửa điểm (khóa lạc quan), TB có trọng số, xếp loại cấu hình, thống kê; integration |
| Tuition | VERIFIED | khoản thu, thanh toán một phần/đủ idempotent, công nợ, lịch sử, doanh thu (VND) |
| Notifications | VERIFIED (API + UI) | tự sinh theo sự kiện, gửi thủ công, đã đọc, lọc theo loại |
| Reports | VERIFIED | 8 báo cáo, lọc thời gian, CSV UTF-8 (Excel) |
| Material Management | VERIFIED (LOCAL) | tạo, upload, phân loại, liên kết khóa/lớp/GV/HV, preview, download, xóa, trạng thái xử lý, kho học liệu |
| Frontend kết nối API | VERIFIED | mọi trang dùng API thật, không dữ liệu tĩnh |
| Dữ liệu lưu thực tế | VERIFIED | PostgreSQL 16, migration `schema_v1`, seed |

## B. Cloud Platform

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Azure App Service | IMPLEMENTED | Bicep + script; **gói deploy chạy thử local ở production: VERIFIED** |
| Azure PostgreSQL | IMPLEMENTED | Bicep (TLS, backup), `scripts/bootstrap_db.py` |
| Key Vault | IMPLEMENTED | Bicep RBAC + references; đọc metadata secret |
| Managed Identity | IMPLEMENTED | system-assigned, 3 role assignment |
| Application Insights | IMPLEMENTED | SDK nạp có điều kiện, custom telemetry |
| Azure Monitor | IMPLEMENTED | alerts + availability test (Bicep), đọc metrics REST |
| OSS Quarantine / Published | IMPLEMENTED | provider V4, lifecycle/CORS/versioning, script; LOCAL mock VERIFIED |
| RAM | IMPLEMENTED | 2 policy JSON + role/users trong script |
| Function Compute | IMPLEMENTED (logic VERIFIED) | 15 test Python trong Docker; `s.yaml`; chưa deploy |
| SLS | IMPLEMENTED | log JSON có correlationId; GetLogs (chữ ký có unit test) |
| CloudMonitor | IMPLEMENTED | DescribeMetricList/RuleList (chữ ký khớp vector chính thức); tên metric FC cần xác nhận |
| PDF processing | VERIFIED (LOCAL + Python unit) | |
| HMAC callback | VERIFIED | unit TS + Python (vector chung) + E2E (callback thật, giả mạo → 401) |
| Signed URL | VERIFIED (LOCAL); OSS IMPLEMENTED | |
| Reconciliation | IMPLEMENTED, chạy thủ công VERIFIED | chạy không lỗi; kịch bản treo/khôi phục chưa có test tự động |
| Backup and recovery | VERIFIED (local pg_dump/restore); Azure PITR IMPLEMENTED (tài liệu) | |
| Cross-cloud integration | VERIFIED ở LOCAL MODE (cùng hợp đồng); chưa chạy Azure ↔ Alibaba thật | |
| Cloud Operations Dashboard | VERIFIED | 8 trang, trạng thái đo trực tiếp, MOCK/NOT CONFIGURED rõ ràng |

## Lệch so với ROADMAP / yêu cầu
- **Không đăng nhập** (theo yêu cầu) → ngữ cảnh demo ký HMAC (I-01); ROADMAP D-24/D-28 không áp dụng.
- **Hợp đồng API nghiệp vụ** chưa đưa vào OpenAPI (I-04); kiểu ở `apps/web/src/lib/types.ts`.
- Bảng `notifications` (F14) và báo cáo CSV (F12) vốn là P1 trong ROADMAP — đã làm theo yêu cầu mới.
- Không có rate limiting, không quét malware, không RLS (đã sẵn `app.tenant_id` trong giao dịch).

## Việc còn lại
1. Triển khai thật: chạy `deploy-aliyun.ps1` → `deploy-azure.ps1` → deploy FC; biên dịch Bicep; xác nhận tên metric CloudMonitor FC 3.0.
2. Kiểm thử cloud thật (OSS, FC trigger, Key Vault/MI, App Insights, PITR) và cập nhật bảng trên.
3. OpenAPI cho endpoint nghiệp vụ; code-split frontend; test tự động cho reconciler và E2E trình duyệt (Playwright).
4. Rate limiting, giới hạn truy cập App Service khi công khai (không có đăng nhập).
