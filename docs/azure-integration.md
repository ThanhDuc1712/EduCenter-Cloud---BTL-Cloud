# Tích hợp Azure

Trạng thái: hạ tầng theo `infra/azure/main.bicep` đã được deploy ngày 24–25/11 (theo mô tả PR #4: App Service F1,
PostgreSQL B1ms, hai Key Vault, App Insights, identity OIDC; chưa có bản build app). **Phần app settings bổ sung khi
tích hợp mới chỉ được validate (`az bicep build`), chưa deploy.** Chi tiết và lệnh: [infra/azure/README.md](../infra/azure/README.md).

## App Service
- Linux, `NODE|24-lts`, SKU `F1` mặc định (đổi `B1` để có Always On + health check), HTTPS only, TLS 1.2, FTPS tắt,
  lệnh khởi động `cd apps/api && node dist/main.js`, system-assigned identity.
- Readiness `GET /api/v1/health`; liveness `/api/v1/health/live`. Graceful shutdown theo `SHUTDOWN_TIMEOUT_MS`.
- Gói deploy: `deploy-azure.ps1 -PackageOnly` → `.data/deploy/educenter-app.zip`.
- Storage/processing: `local` (mô phỏng, file ở `/home/data/educenter`) cho tới khi đặt hai bucket OSS.

## PostgreSQL Flexible Server
- v16, Burstable B1ms, TLS bắt buộc, backup 7 ngày; **không** có rule `0.0.0.0`, chỉ IP outbound của Web App
  (`set-pg-firewall.ps1`) và rule tạm khi migration.
- Vai trò `edu_migrator` / `edu_runtime` do `infra/azure/scripts/bootstrap_db.py` tạo.
- Pool: `DB_CONNECTION_LIMIT=5`/instance, `CONNECTION LIMIT 20` cho runtime.
- Ứng dụng từ chối khởi động ở production nếu kết nối bằng role superuser/BYPASSRLS.

## Key Vault + Managed Identity
- Hai vault RBAC: `kv-edu-rt-<suffix>` (secret app đọc lúc chạy) và `kv-edu-ops-<suffix>` (migrator, admin); soft delete 7 ngày.
- App Service đọc secret runtime bằng **Key Vault references** với identity có vai trò *Key Vault Secrets User*.

## Application Insights
- SDK `applicationinsights` v3 khởi động trước mọi module (chỉ nạp khi có connection string): requests, exceptions,
  dependencies (HTTP tới OSS/Azure, PostgreSQL), cloud role `educenter-api`.
- Custom: dependency `oss.*`, `keyvault.list`, `callback.http`; metric `callback.latency`, `fc.duration`, `local.processor.duration`; event `material.processed`.

## Azure Monitor
Chưa có trong template: alert, availability test, diagnostic settings, role *Monitoring Reader* / *Log Analytics Reader*
và các biến `AZURE_*`. Trang Cloud Monitoring/Logs báo `NOT CONFIGURED` cho tới khi bổ sung.

## Backup & khôi phục
Xem [cloud-recovery.md](cloud-recovery.md).
