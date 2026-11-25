# Cài đặt trên Windows 10/11

Mọi bước dùng **PowerShell** (không cần WSL hay terminal Linux).

## 1. Công cụ

| Công cụ | Cài đặt | Kiểm tra |
|---|---|---|
| Node.js 24 LTS | `winget install OpenJS.NodeJS.LTS` (hoặc fnm: `winget install Schniz.fnm`, `fnm install 24`) | `node -v` → `v24.x` |
| pnpm 10.34.9 | `corepack enable; corepack prepare pnpm@10.34.9 --activate` | `pnpm -v` |
| Docker Desktop | `winget install Docker.DockerDesktop`, khởi động lại, mở Docker Desktop | `docker compose version` |
| Git | `winget install Git.Git` | `git --version` |
| PostgreSQL | **Không cần cài** — chạy trong Docker. Chỉ cài khi muốn dùng `psql` ngoài container. | — |
| (Cloud) Azure CLI | `winget install Microsoft.AzureCLI` | `az version` |
| (Cloud) Aliyun CLI, Serverless Devs | xem [aliyun-integration.md](aliyun-integration.md) | `aliyun version`, `s -v` |

Python **không** bắt buộc: test Function Compute chạy trong container `python:3.12-slim`.

Nếu PowerShell chặn script: dùng `powershell -ExecutionPolicy Bypass -File <script>` (không đổi chính sách hệ thống).

## 2. Lấy mã nguồn và kiểm tra môi trường

```powershell
git clone https://github.com/ThanhDuc1712/EduCenter-Cloud---BTL-Cloud.git
cd EduCenter-Cloud---BTL-Cloud
powershell -ExecutionPolicy Bypass -File scripts\windows\check-environment.ps1
```

## 3. Cài đặt lần đầu

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\setup-local.ps1
```

Script thực hiện: tạo `.env` từ `.env.example` (mọi `change-me-*` thay bằng chuỗi ngẫu nhiên, mỗi
placeholder một giá trị để URL và mật khẩu khớp nhau) → `pnpm install --frozen-lockfile` → build
`@educenter/shared` → `docker compose up -d postgres` (chờ healthy, tạo vai trò `edu_migrator`/`edu_runtime`)
→ `prisma generate` + `prisma migrate deploy` → seed.

## 4. Chạy, kiểm thử, dừng

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\start-local.ps1     # mở 2 cửa sổ: API, web
powershell -ExecutionPolicy Bypass -File scripts\windows\test-local.ps1      # bảng PASS/FAIL
powershell -ExecutionPolicy Bypass -File scripts\windows\stop-local.ps1
```

## 5. Kết nối Cloud

1. `deploy-aliyun.ps1` — bucket OSS, RAM, (sau bước 2) Function Compute.
2. `deploy-azure.ps1` — App Service, PostgreSQL, Key Vault, App Insights, migration, deploy mã.

Thứ tự và lý do: [cloud-architecture.md § Triển khai](cloud-architecture.md#triển-khai-thủ-công).

## Lưu ý Windows đã gặp và xử lý

- PowerShell 5.1 đọc `.ps1` UTF-8 không BOM theo ANSI → mọi script giữ **ASCII**.
- `Set-Content -Encoding utf8` của PS 5.1 thêm BOM và `Get-Content` không chỉ định encoding làm hỏng tiếng Việt → các script ghi file bằng `[IO.File]::WriteAllText(..., UTF8Encoding($false))`.
- Đường dẫn có dấu cách (`Studio Code`) được hỗ trợ; `npx` trên một số máy hỏng với dấu cách → dùng `pnpm exec`.
- Gói deploy dùng `node-linker=hoisted` vì zip tạo trên Windows không giữ symlink của pnpm.
