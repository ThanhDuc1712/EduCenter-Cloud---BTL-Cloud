# Kiến trúc API

NestJS 11 modular monolith (`apps/api/src`), tiền tố `/api/v1`, JSON.

## Chuỗi xử lý một request

`RequestIdMiddleware` (X-Request-ID do máy chủ sinh, access log JSON, metric `api.request`) →
`BodyParserMiddleware` (JSON có giới hạn; **raw Buffer** dưới `/internal/*` cho HMAC; multipart chỉ ở upload local)
→ `DenyByDefaultGuard` → `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) → controller → service
→ `AllExceptionsFilter` (`{ code, message, requestId, fieldErrors? }`, không lộ stack/SQL).

## Chính sách truy cập (`common/authz/policy.decorator.ts`)

| Decorator | Ý nghĩa |
|---|---|
| (không có) | **403** — test `route-inventory.spec.ts` thất bại nếu route thiếu chính sách |
| `@PublicPolicy()` | health; upload/download local (xác thực bằng token ký, như OSS) |
| `@Roles(...)` / `@AnyRole()` | principal do máy chủ dựng từ ngữ cảnh demo; phạm vi dữ liệu kiểm tra trong service |
| `@InternalHmacPolicy()` | callback Function Compute — handler bắt buộc xác minh HMAC |
| `@OpsPolicy()` | `/cloud/*` — ADMIN; production thêm kiểm tra IP `OPS_ALLOWED_CIDRS` |

Yêu cầu ghi (POST/PUT/PATCH/DELETE) có header `Origin` khác `APP_ORIGIN` → 403 (same-origin, D-03; không bật CORS).

## Module

`context`, `dashboard`, `students`, `teachers`, `courses` (+rooms), `classrooms` (+sessions, schedule), `enrollments`,
`attendance`, `grades`, `tuition`, `notifications` (+activity), `reports`, `storage`, `materials` (+callback, reconciler),
`cloud`. Danh sách endpoint: [education-modules.md](education-modules.md), [cross-cloud-data-flow.md](cross-cloud-data-flow.md),
[cloud-monitoring.md](cloud-monitoring.md).

## Quy ước

- Phân trang `?page&pageSize` (≤ 100) → `{ items, meta: { page, pageSize, total, totalPages } }`.
- Tiền là chuỗi số nguyên VND; ngày `YYYY-MM-DD`; thời điểm ISO-8601 UTC.
- Mã lỗi nghiệp vụ: `SCHEDULE_CONFLICT`, `CLASSROOM_FULL`, `ENROLLMENT_DUPLICATE`, `GRADE_VERSION_CONFLICT`,
  `IDEMPOTENCY_KEY_REQUIRED|REUSED`, `PAYMENT_EXCEEDS_BALANCE`, `INVALID_MATERIAL_TRANSITION`, `MATERIAL_NOT_READY`…
- Thông điệp lỗi hiển thị được cho người dùng (tiếng Việt).

## Hợp đồng kiểu dữ liệu (lệch khỏi ROADMAP §7.5 — I-04)

OpenAPI (`packages/api-contract`) vẫn là nguồn cho `/health`. Các endpoint nghiệp vụ dùng kiểu TypeScript
trong `apps/web/src/lib/types.ts` + DTO class-validator ở API (validation phía máy chủ là chuẩn). Việc sinh
OpenAPI đầy đủ cho ~100 endpoint chưa làm — xem [completion-report.md](completion-report.md).

## Frontend

React 19 + Vite 8 + Tailwind 4 + thành phần kiểu shadcn/ui (Radix), React Router 7, TanStack Query 5,
React Hook Form + Zod 4. Client `apps/web/src/lib/api.ts` (fetch same-origin, không lưu gì vào localStorage).
Trang có trạng thái loading/empty/error, validation form, toast, responsive (sidebar thu gọn trên mobile).
Trên cloud, API phục vụ SPA đã build cùng origin (`WEB_DIST_DIR`) với CSP riêng cho SPA.
