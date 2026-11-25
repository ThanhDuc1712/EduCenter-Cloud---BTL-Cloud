# Phát triển local (LOCAL MODE)

LOCAL MODE chạy toàn bộ website mà **không cần credential cloud**: PostgreSQL 16 trong Docker, lưu trữ
tệp trên đĩa (`apps/api/.data/storage`, mô phỏng OSS) và bộ xử lý tài liệu chạy trong tiến trình API
(mô phỏng Function Compute, luôn được gắn nhãn **MOCK / LOCAL_MOCK** trên giao diện, log và job).

Hướng dẫn cài đặt Windows từng bước: [windows-setup.md](windows-setup.md).

## Lệnh nhanh (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\check-environment.ps1   # kiểm tra Node 24, pnpm, Docker, cổng
powershell -ExecutionPolicy Bypass -File scripts\windows\setup-local.ps1         # .env ngẫu nhiên, install, DB, migrate, seed
powershell -ExecutionPolicy Bypass -File scripts\windows\start-local.ps1         # API :3000 + web :5173 (hot reload)
powershell -ExecutionPolicy Bypass -File scripts\windows\start-local.ps1 -Production  # 1 origin :3000 giống App Service
powershell -ExecutionPolicy Bypass -File scripts\windows\test-local.ps1          # lint, typecheck, unit, build, integration, FC, E2E
powershell -ExecutionPolicy Bypass -File scripts\windows\stop-local.ps1          # dừng (giữ dữ liệu); -ResetData để xóa
```

Mở http://localhost:5173 → trang **Đăng nhập** (tài khoản seed: xem mục [Đăng nhập / đăng ký](#đăng-nhập--đăng-ký)).
Với `AUTH_MODE=demo`, góc phải trên cùng vẫn có **bộ chuyển vai trò demo** (Admin / Giáo viên / Học viên).
Máy chủ xác định vai trò từ phiên đăng nhập hoặc hồ sơ đã seed — trình duyệt không gửi `role` hay `tenantId`.

## Lệnh pnpm tương đương

| Việc | Lệnh |
|---|---|
| Cài đặt | `pnpm install --frozen-lockfile` |
| Build package dùng chung | `pnpm --filter @educenter/shared build` |
| Khởi động DB | `pnpm db:up` |
| Migration (vai trò `edu_migrator`) | `pnpm --filter api prisma:deploy` (tạo migration mới: `pnpm db:migrate`) |
| Seed dữ liệu demo (2 trung tâm, idempotent) | `pnpm --filter api db:seed` |
| Chạy dev | `pnpm dev` |
| Kiểm tra | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build` |
| E2E (API phải đang chạy) | `node tests/e2e/integration-flow.mjs` |

## Biến môi trường chính (`.env`)

| Biến | Ý nghĩa | LOCAL |
|---|---|---|
| `DATABASE_URL` / `MIGRATION_DATABASE_URL` | runtime (`edu_runtime`) / migration (`edu_migrator`) | Docker 127.0.0.1:5433 |
| `AUTH_MODE` | `session` (bắt buộc đăng nhập) | `demo` (không đăng nhập → ngữ cảnh demo) | `session` |
| `REGISTRATION_ENABLED`, `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS` | mở đăng ký học viên; hết hạn phiên (phút không hoạt động / giờ tuyệt đối) | `true`, `120`, `24` |
| `SEED_DEMO_PASSWORD` | mật khẩu các tài khoản do seed tạo | `Demo@12345` |
| `DEMO_MODE`, `DEMO_TENANT_SLUG`, `DEMO_DEFAULT_PERSONA`, `DEMO_CONTEXT_SECRET` | ngữ cảnh demo (chỉ dùng khi `AUTH_MODE=demo`); `DEMO_TENANT_SLUG` cũng là mã trung tâm điền sẵn ở form đăng nhập | `true`, `hanoi-center`, `admin` |
| `STORAGE_PROVIDER` | `local` \| `oss` | `local` |
| `PROCESSING_PROVIDER` | `local` \| `aliyun-fc` | `local` |
| `CALLBACK_HMAC_KEYS` | `k1:secret[,k2:secret]` (≥ 32 ký tự) | sinh ngẫu nhiên |
| `RECONCILE_INTERVAL_SECONDS` | chu kỳ đối soát (0 = tắt) | 60 |
| `APPLICATIONINSIGHTS_CONNECTION_STRING`, `AZURE_*`, `ALIYUN_*`, `OSS_*` | chỉ CLOUD MODE | để trống → `NOT CONFIGURED` |

Thiếu/sai biến bắt buộc → API thoát ngay với tên biến (không in giá trị).

## Đăng nhập / đăng ký

Sau `pnpm db:migrate` + `pnpm --filter api db:seed`, mở http://localhost:5173 → trang **Đăng nhập** (mã trung tâm `hanoi-center` hoặc `saigon-center`):

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Admin | `admin@hanoi-center.edu.example` | `SEED_DEMO_PASSWORD` (mặc định `Demo@12345`) |
| Giáo viên / Học viên | email trên hồ sơ đã seed (xem trang Giáo viên / Học viên khi đăng nhập Admin) | như trên |

**Đăng ký học viên** (`/register`) tạo tài khoản STUDENT kèm hồ sơ học viên mới (mã HV#### tự sinh) và đăng nhập luôn; Admin nhận thông báo. Đăng ký không bao giờ cấp quyền ADMIN/TEACHER và không gắn vào hồ sơ có sẵn.

Integration test và `tests/e2e/integration-flow.mjs` chuyển persona qua `PUT /context` nên cần `AUTH_MODE=demo` (test tích hợp tự đặt; khi chạy e2e với API đang chạy, đặt `AUTH_MODE=demo` trong `.env`).

## Dữ liệu demo

Seed tạo `hanoi-center` (60 học viên, 8 giáo viên, 9 lớp) và `saigon-center` (40 học viên) với lịch,
điểm danh, điểm và học phí **tương đối theo ngày hiện tại** — luôn có lịch hôm nay. Dữ liệu là tổng hợp,
không phải dữ liệu thật. Test integration/E2E tạo thêm bản ghi mã `E2E-*`, `CAP-*`; chạy lại seed để làm sạch.

## Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| `Invalid environment configuration: X` | thiếu biến `X` trong `.env` |
| `/api/v1/health` 503 | DB chưa chạy: `docker compose ps` |
| `TENANT_NOT_CONFIGURED` | chưa seed: `pnpm --filter api db:seed` |
| Tài liệu đứng ở PROCESSING | API không gọi được `INTERNAL_BASE_URL`; reconciler sẽ áp dụng result JSON sau `PROCESSING_TIMEOUT_SECONDS` |
| Script PowerShell báo lỗi cú pháp lạ | tệp `.ps1` phải là ASCII (PowerShell 5.1 đọc UTF-8 không BOM như ANSI) |
