# Bảo mật cloud và dịch vụ

## Đăng nhập / đăng ký (`AUTH_MODE=session`, mặc định)
- `POST /api/v1/auth/login` (`tenantSlug` + email + mật khẩu, D-24), `POST /auth/register` (chỉ tạo tài khoản STUDENT + hồ sơ mới), `POST /auth/logout`, `POST /auth/change-password` (thu hồi các phiên khác).
- Mật khẩu băm **Argon2id** (`node:crypto`, m=19 MiB, t=2, p=1); không lưu/ghi log mật khẩu thô. Email chưa tồn tại vẫn chạy Argon2 (không dò được tài khoản qua thời gian phản hồi); mọi lỗi đăng nhập trả cùng 401 `AUTH_INVALID_CREDENTIALS`.
- Phiên: token ngẫu nhiên 256-bit trong cookie HttpOnly, SameSite=Lax (`__Host-educenter_session`, Secure ở production); DB chỉ lưu SHA-256 (`auth_sessions`). Hết hạn theo thời gian không hoạt động + tuyệt đối; xoay phiên khi đăng nhập; thu hồi khi đăng xuất. Phiên gắn cố định tenant.
- Giới hạn thử (`login_attempts`, dùng chung giữa các instance): 5 lần sai / 15 phút / tài khoản, 50 lần sai / 15 phút / IP, 10 đăng ký / giờ / IP → 429 + `Retry-After`.
- Login/register/logout cũng qua kiểm tra Origin (chống login CSRF). Route không có phiên → 401.

## Ngữ cảnh demo (chỉ khi `AUTH_MODE=demo`)
- Yêu cầu không có phiên đăng nhập dùng ngữ cảnh demo; phiên đăng nhập hợp lệ luôn được ưu tiên. Tenant cố định bởi `DEMO_TENANT_SLUG`.
- Persona (`admin`, `teacher:<mã>`, `student:<mã>`) lưu trong cookie HttpOnly, SameSite=Lax (Secure ở production),
  ký HMAC bằng `DEMO_CONTEXT_SECRET`; máy chủ tra hồ sơ trong DB để xác định vai trò. Body/query chứa `tenantId`/`role` bị từ chối (400).
- Chuyển persona chỉ khi `DEMO_MODE=true`. Khi công khai, **bật giới hạn truy cập ở tầng hạ tầng** (App Service
  access restrictions hoặc Easy Auth) nếu chạy `AUTH_MODE=demo` — chế độ này không yêu cầu đăng nhập.
- API quản trị cloud `/cloud/*`: chỉ ADMIN và, ở production, IP trong `OPS_ALLOWED_CIDRS` (trống → từ chối). Đã kiểm thử 403.

## Giữa các dịch vụ
| Kênh | Cơ chế |
|---|---|
| App Service → Key Vault | Managed Identity (system-assigned), RBAC *Key Vault Secrets User*, Key Vault references |
| App Service → Azure Monitor/Log Analytics | Managed Identity, *Monitoring Reader*, *Log Analytics Reader* |
| App Service → PostgreSQL | TLS bắt buộc, `edu_runtime` (DML), firewall Azure services |
| App Service → OSS | RAM user `educenter-api` least privilege, key trong Key Vault |
| Browser → OSS | policy/URL ký, hết hạn ngắn, bucket private, CORS chỉ app origin |
| FC → OSS/SLS | RAM role + STS tạm thời (không có key cố định) |
| FC → App Service | HMAC-SHA256 + timestamp + eventId + key ID |

## Secrets
Không có credential trong mã nguồn (`.env` bị gitignore, CI chạy Gitleaks). Validation cấu hình không bao giờ in giá trị;
logger che khóa chứa `secret|token|password|key|connection|database_url`. Script deploy sinh secret cục bộ, ghi vào Key Vault
qua tệp tạm, không in ra màn hình; secret có hạn 180 ngày.

### Xoay vòng khóa HMAC (D-29)
1. Thêm `k2:<mới>` vào secret `callback-hmac-keys` → `k1:<cũ>,k2:<mới>`; restart App Service (Key Vault reference được nạp lại).
2. Cập nhật FC: `CALLBACK_HMAC_KEY_ID=k2`, `CALLBACK_HMAC_SECRET=<mới>` (`s deploy`).
3. Sau khi không còn callback `k1` (xem ops log `keyId`), xóa `k1` khỏi secret, restart.
Đã có unit test chấp nhận chữ ký bằng cả hai key và từ chối chéo key.

### Xoay vòng khóa RAM / DB
RAM: tạo access key thứ 2 → cập nhật Key Vault → restart → xóa key cũ. DB: `ALTER ROLE edu_runtime PASSWORD …` →
cập nhật `database-url` → restart. Key Vault giữ lịch sử version để quay lại.

## HTTP
Helmet: CSP `default-src 'none'` cho API; CSP riêng cho SPA (self + host OSS); HSTS; `frame-ancestors 'none'` (preview local
chỉ cho phép `'self'`); không CORS; không `x-powered-by`; X-Request-ID do máy chủ sinh.

## Giới hạn đã biết
Không quét malware (chỉ kiểm tra cấu trúc PDF, D-11). Không có rate limiting. Không có xác thực người dùng (theo yêu cầu).
