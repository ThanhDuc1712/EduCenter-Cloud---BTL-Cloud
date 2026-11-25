# Các module nghiệp vụ giáo dục

Mọi chức năng có frontend (React) + API (NestJS) + dữ liệu PostgreSQL. Phạm vi theo vai trò được áp dụng
**ở máy chủ** (`apps/api/src/common/authz/scope.ts`); bản ghi ngoài phạm vi trả 404.

| Module | Trang | API chính | Admin | Giáo viên | Học viên |
|---|---|---|---|---|---|
| Tổng quan | `/` | `GET /dashboard` | toàn trung tâm | lớp mình dạy | cá nhân |
| Học viên | `/students`, `/students/:id` | `GET/POST /students`, `PATCH /students/:id`, `POST …/archive|restore`, `GET …/overview` | quản lý | HV lớp mình | — (xem hồ sơ qua tổng quan) |
| Giáo viên | `/teachers`, `/teachers/:id` | `GET/POST /teachers`, `PATCH`, `GET …/overview` | quản lý | bản thân | GV dạy mình |
| Khóa học | `/courses`, `/courses/:id` | `GET/POST /courses`, `PATCH`, `POST …/archive`, `DELETE` (chỉ khi chưa dùng), `GET/POST/PATCH /rooms` | quản lý | khóa có lớp mình | khóa đã học |
| Lớp học | `/classes`, `/classes/:id` | `GET/POST /classrooms`, `PATCH`, `PUT …/slots`, `GET …/students`, `GET/POST …/sessions`, `PATCH /sessions/:id` | quản lý | lớp mình (thêm/sửa buổi) | lớp đã đăng ký |
| Lịch học | `/schedule` | `GET /schedule?from&to&classroomId&teacherId&roomId`, `GET /schedule/conflicts`, `POST /schedule/check` | ✓ + quét trùng | lịch dạy | lịch học |
| Đăng ký học | `/enrollments` | `GET/POST /enrollments`, `PATCH`, `POST …/cancel` | quản lý | xem | của mình |
| Điểm danh | `/attendance`, `/attendance/:sessionId` | `GET/PUT /sessions/:id/attendance`, `GET /attendance/pending|history`, `GET /classrooms/:id/attendance-summary`, `GET /students/:id/attendance-summary` | ✓ | lớp mình | của mình |
| Điểm số | `/grades` | `GET/POST /classrooms/:id/assessments`, `PATCH/DELETE /assessments/:id`, `GET/PUT /assessments/:id/grades`, `GET /classrooms/:id/gradebook`, `GET /students/:id/grades`, `GET/PUT /grade-bands` | ✓ + cấu hình xếp loại | lớp mình | của mình |
| Học phí | `/tuition` | `GET/POST /invoices`, `PATCH`, `POST …/cancel`, `POST /invoices/:id/payments` (Idempotency-Key bắt buộc), `GET /payments`, `GET /tuition/summary` | quản lý | **không** | của mình |
| Thông báo | `/notifications` | `GET /notifications`, `GET …/unread-count`, `POST …/:id/read`, `POST …/read-all`, `POST /notifications` | gửi | nhận | nhận |
| Báo cáo | `/reports` | `GET /reports/:kind?from&to&format=json|csv` — students, teachers, courses, classes, attendance, grades, revenue, debts | ✓ | — | — |
| Hoạt động | (dashboard) | `GET /activity` | ✓ | — | — |

## Quy tắc nghiệp vụ được thực thi

- **Trùng lịch (D-18):** khi tạo/đổi buổi, đổi giáo viên, sinh buổi từ thời khóa biểu: khóa hàng
  `teachers` và `rooms` (`SELECT … FOR UPDATE`) rồi kiểm tra chồng giờ trong cùng giao dịch → 409
  `SCHEDULE_CONFLICT` kèm chi tiết. `POST /schedule/check` là chạy thử; `GET /schedule/conflicts` quét dữ liệu.
- **Sức chứa:** khóa hàng lớp trước khi đếm ghi danh ACTIVE → không vượt sức chứa kể cả đồng thời
  (đã kiểm thử 5 yêu cầu song song, sức chứa 2). Phòng nhỏ hơn sức chứa lớp → 422.
- **Đăng ký trùng:** `UNIQUE(tenant, classroom, student)` + 409 `ENROLLMENT_DUPLICATE`; đăng ký đã hủy được kích hoạt lại.
  Ghi danh tự tạo khoản học phí (học phí lớp hoặc khóa) và thông báo học viên; hủy ghi danh hủy khoản chưa thanh toán.
- **Điểm:** thang 10, điểm TB có trọng số (`Σ score/max·10·weight / Σ weight`), tổng trọng số ≤ 100%,
  khóa lạc quan theo `version` (409 `GRADE_VERSION_CONFLICT`), xếp loại cấu hình theo trung tâm.
- **Chuyên cần:** tỷ lệ = (có mặt + đi muộn) / tổng lượt điểm danh; không điểm danh trước giờ học > 30 phút; vắng → thông báo.
- **Học phí (VND, BIGINT ↔ chuỗi JSON, D-12):** thanh toán một phần/đủ; khóa hàng hóa đơn; không thu vượt số còn nợ;
  `Idempotency-Key` cùng nội dung → trả lại thanh toán cũ, khác nội dung → 409; hóa đơn đã có thanh toán không hủy được.
- **Mã tự sinh** (HV####, GV###, HD#####): khóa `pg_advisory_xact_lock` theo tenant (sửa lỗi trùng mã khi tạo đồng thời).
- **Thông báo** tự sinh khi: đổi/hủy/thêm buổi học, đổi thời khóa biểu, đổi giáo viên, ghi danh, khoản học phí mới,
  thanh toán, điểm mới, vắng mặt, tài liệu mới READY.
- **CSV:** UTF-8 BOM (mở đúng tiếng Việt trong Excel), chống formula injection (`=`, `+`, `-`, `@`).
- **Lưu trữ thay vì xóa:** học viên `ARCHIVED`, khóa học `ARCHIVED`; lịch sử điểm/điểm danh/học phí giữ nguyên.

## Không triển khai (theo yêu cầu)

Đăng ký/đăng nhập/đăng xuất/quên mật khẩu/hồ sơ người dùng. Thay bằng ngữ cảnh demo — xem [cloud-security.md](cloud-security.md#ngữ-cảnh-demo-không-đăng-nhập).
