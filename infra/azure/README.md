# Azure — môi trường demo EduCenter (P0-02, P0-11)

| File | Vai trò |
|---|---|
| `main.bicep` | Log Analytics (cap 1 GB/ngày), App Insights, 2 Key Vault RBAC (runtime / ops), App Service Linux + System MI, PostgreSQL Flexible (TLS bắt buộc), user-assigned identity + federated credential cho GitHub OIDC |
| `demo.bicepparam` | Tham số; đọc vùng, hậu tố, object ID và mật khẩu admin PG từ biến môi trường |
| `scripts/set-pg-firewall.ps1` | Rule firewall theo IP cụ thể (outbound Web App, IP admin tạm) — không có rule 0.0.0.0 |
| `scripts/bootstrap_db.py` | Tạo DB `educenter`, role `edu_migrator` / `edu_runtime`, lưu URL vào Key Vault, tự kiểm TLS + không có DDL |

Triển khai (PowerShell tại gốc repo, đã `az login`, đã đặt các biến `EDU_*`):

```powershell
az bicep build --file infra/azure/main.bicep --stdout | Out-Null
az deployment group what-if -g rg-educenter-demo --name educenter-infra --parameters infra/azure/demo.bicepparam
az deployment group create  -g rg-educenter-demo --name educenter-infra --parameters infra/azure/demo.bicepparam
az deployment group show    -g rg-educenter-demo --name educenter-infra --query properties.outputs
```

Bảng ngân sách kết nối (điền sau bootstrap): `max_connections` = …; runtime `connection_limit` 5 × số instance … + migration 1 + quản trị 2 ≤ 80% × max_connections.

Bàn giao cho Doanh (OIDC): client ID của `id-educenter-deploy-<suffix>`, tenant ID, subscription ID (gửi qua GitHub Environment `demo`, không qua chat), subject `repo:ThanhDuc1712/EduCenter-Cloud---BTL-Cloud:environment:demo`.
