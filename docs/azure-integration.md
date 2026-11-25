# Tích hợp Azure

Trạng thái: mã và IaC đã viết; **chưa triển khai lên subscription thật** (không có credential trong phiên phát triển).

## App Service
- Bicep: Linux, `NODE|24-lts`, B1, Always On, HTTPS only, TLS 1.2, FTPS tắt, `healthCheckPath=/api/v1/health`,
  lệnh khởi động `cd apps/api && node dist/main.js`, system-assigned identity.
- Readiness `GET /api/v1/health` (DB ping có timeout, 503 khi DB lỗi); liveness `/api/v1/health/live`.
- Graceful shutdown: SIGTERM → Nest đóng kết nối, hạn chót `SHUTDOWN_TIMEOUT_MS` (đã có test).
- Log JSON lines ra stdout → App Service console logs → Log Analytics (diagnostic setting).
- Gói deploy: `deploy-azure.ps1 -PackageOnly` → `.data/deploy/educenter-app.zip` (**đã build và chạy thử local ở chế độ production**:
  SPA + API cùng origin, deep link, 404 API, Cloud Ops API trả 403 khi không có `OPS_ALLOWED_CIDRS`).

## PostgreSQL Flexible Server
- v16, Burstable B1ms, `require_secure_transport=on`, backup 7 ngày (PITR), firewall chỉ "Azure services" + rule tạm khi migration.
- Vai trò `edu_migrator` / `edu_runtime` qua `infra/azure/postgres-roles.sql`; `DATABASE_URL` có `sslmode=require`.
- Pool: `DB_CONNECTION_LIMIT=10`/instance, `CONNECTION LIMIT 40` cho runtime. Diagnostics: PostgreSQLLogs + AllMetrics.
- Ứng dụng từ chối khởi động ở production nếu kết nối bằng role superuser/BYPASSRLS.

## Key Vault + Managed Identity
- `enableRbacAuthorization`, soft delete 7 ngày, purge protection, audit log (`AuditEvent`) → Log Analytics.
- App Service đọc secret bằng **Key Vault references** (`@Microsoft.KeyVault(VaultName=…;SecretName=…)`) với identity
  có vai trò *Key Vault Secrets User* — không có secret trong mã hay app settings.
- Secret: `database-url`, `migration-database-url`, `demo-context-secret`, `callback-hmac-keys`, `oss-access-key-*`,
  `aliyun-readonly-access-key-*`, `pg-*-password`; tạo với hạn 180 ngày. Xoay vòng: [cloud-security.md](cloud-security.md).
- Trang Cloud Resources đọc **metadata** secret (tên, số version, ngày hết hạn) bằng `DefaultAzureCredential` — không bao giờ trả giá trị.

## Application Insights
- SDK `applicationinsights` v3 khởi động trước mọi module (chỉ nạp khi có connection string): requests, exceptions,
  dependencies (HTTP tới OSS/Azure, PostgreSQL), cloud role `educenter-api`.
- Custom: dependency `oss.*`, `keyvault.list`, `callback.http`; metric `callback.latency`, `fc.duration`, `local.processor.duration`; event `material.processed`.

## Azure Monitor
- Alert: Http5xx > 5/5 phút, HealthCheckStatus < 100, PostgreSQL CPU > 80%; availability test `/api/v1/health` từ SG/HK; action group email.
- Identity có *Monitoring Reader* + *Log Analytics Reader*: trang Cloud Monitoring/Logs đọc metric App Service/PostgreSQL,
  Resource Health và truy vấn KQL `AppTraces`.
- Chi phí: Cost Management Query (MonthToDate theo dịch vụ) — cần quyền *Cost Management Reader*; nếu thiếu → `NOT CONFIGURED`.

## Backup & khôi phục
Xem [cloud-recovery.md](cloud-recovery.md).
