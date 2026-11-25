# Kiến trúc cơ sở dữ liệu

PostgreSQL 16 · Prisma 7 (`apps/api/prisma/schema.prisma`) · migration `prisma/migrations/*_schema_v1`.

## Nguyên tắc

- Mọi bảng nghiệp vụ có `tenant_id`; `UNIQUE(tenant_id, id)` và **khóa ngoại tổng hợp** `(tenant_id, x_id) → (tenant_id, id)`:
  một bản ghi không thể tham chiếu bản ghi của trung tâm khác (đã kiểm thử: tạo enrollment chéo tenant bị DB từ chối).
- Tiền `BIGINT` (VND), điểm `DECIMAL(5,2)`, thời điểm `timestamptz` UTC, ngày `date`; múi giờ nghiệp vụ Asia/Ho_Chi_Minh.
- Ghi nghiệp vụ trong giao dịch `TenantTx` (đặt `app.tenant_id` cục bộ giao dịch — sẵn sàng bật RLS, D-26).
- Ứng dụng kết nối bằng `edu_runtime` (DML, không superuser/BYPASSRLS/DDL); migration bằng `edu_migrator` (D-25).
  `activity_logs`, `material_processing_events`: runtime chỉ INSERT/SELECT; `payments`: không DELETE.
- Ràng buộc CHECK: sức chứa > 0, ngày kết thúc ≥ bắt đầu, `ends_at > starts_at`, trọng số 0–100, điểm ≥ 0,
  `0 ≤ paid ≤ amount − discount`, giờ trong ngày hợp lệ…

## Mô hình

| Bảng | Vai trò | Unique / index đáng chú ý |
|---|---|---|
| `tenants` | trung tâm | `slug` |
| `students`, `teachers` | con người | `(tenant, code)`; index `(tenant, status, full_name)` |
| `courses`, `rooms` | danh mục | `(tenant, code)`, `(tenant, name)` |
| `classrooms` | lớp (khóa, GV, phòng, sức chứa, học phí riêng) | `(tenant, code)`; index theo status/teacher/course |
| `class_schedule_slots` | thời khóa biểu tuần | — |
| `class_sessions` | buổi học (sao `teacher_id` từ lớp, D-04/D-18) | index `(tenant, teacher, starts_at)`, `(tenant, room, starts_at)` |
| `enrollments` | ghi danh | `(tenant, classroom, student)` |
| `attendances` | điểm danh | `(tenant, session, student)` |
| `assessments`, `grades`, `grade_bands` | điểm & xếp loại | `(tenant, assessment, student)`; `grades.version` |
| `invoices`, `payments` | học phí | `(tenant, code)`; `payments(tenant, idempotency_key)` |
| `notifications` | thông báo nội bộ (fan-out theo người nhận) | index theo người nhận + thời gian |
| `activity_logs` | nhật ký nghiệp vụ append-only | index `(tenant, created_at)` |
| `materials` | metadata tài liệu: object key, version, checksum, trạng thái (không lưu tệp) | `quarantine_key` unique |
| `material_processing_jobs` | từng lần xử lý (bộ xử lý, correlation ID, thời gian, độ trễ callback, lỗi) | `(material, attempt)` |
| `material_processing_events` | lịch sử chuyển trạng thái; `event_id` unique chống replay callback | `event_id` |
| `ops_log_entries` | log vận hành cloud (giữ 30 ngày) | index theo thời gian / provider+service / correlation |
| `background_job_runs` | lịch sử reconciler (D-32) | — |

## Vận hành

- Migration local: `pnpm db:migrate`; cloud: `deploy-azure.ps1 -Migrate` (mở firewall tạm cho IP vận hành rồi xóa).
- Vai trò trên Azure: `infra/azure/scripts/bootstrap_db.py`.
- Sao lưu/khôi phục: [cloud-recovery.md](cloud-recovery.md).
