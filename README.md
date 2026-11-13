# EduCenter Cloud

B2B SaaS quản lý trung tâm giáo dục — multi-tenant, ba vai trò Admin / Teacher / Student.
Chạy trên **Microsoft Azure + Alibaba Cloud** (BTL Cloud, tổ hợp số 9).

> **Trạng thái: Phase 0 — mới có bộ khung repository.** Chưa có ứng dụng chạy được, chưa có CI.
> Kế hoạch, task và quy tắc làm việc: [`ROADMAP.md`](ROADMAP.md).

## Stack

| Lớp | Công nghệ |
|---|---|
| Frontend | React + TypeScript + Vite (`apps/web`) |
| Backend | NestJS + TypeScript, Express adapter, Modular Monolith (`apps/api`) |
| Database | PostgreSQL + Prisma |
| API contract | OpenAPI 3.1 (`packages/api-contract`) |
| Serverless worker | Python trên Alibaba Function Compute (`functions/material-processor`) |
| Cloud | Azure (App Service, PostgreSQL Flexible, Key Vault) + Alibaba Cloud (OSS, FC, RAM) |
| CI/CD | GitHub Actions |
| Monorepo | pnpm workspace (không Nx/Turborepo) |

## Cấu trúc repository

```text
apps/
  api/                    NestJS API                  — Anh (P0-07), Hà (prisma/, P0-08)
  web/                    React SPA                   — Doanh (P0-10)
packages/
  api-contract/           OpenAPI contract + client   — Đức (P0-09)
functions/
  material-processor/     Python FC worker            — Dương (P0-15)
infra/
  azure/                  Azure IaC                   — Giang (P0-02, P0-11)
  aliyun/                 OSS / RAM / FC              — Dương (P0-03, P0-13, P0-14)
tests/
  e2e/  security/  load/  E2E, security, k6           — Giang
docs/
  handoff/                File giao việc cá nhân (DUC, DOANH, ANH, HA, DUONG, GIANG)
.github/                  CODEOWNERS, PR template (workflow CI do P0-06 bổ sung)
ROADMAP.md                Tài liệu điều phối duy nhất của nhóm
```

Thư mục chỉ có `.gitkeep` là chỗ để owner tương ứng tạo code. Không tạo thêm thư mục trong `docs/` khi task chưa thực sự cần.

## Yêu cầu môi trường

- **Node.js 24** (xem `.nvmrc`)
- **pnpm 10.34.9** (khóa trong `package.json` → `packageManager`)
- Git

Bật pnpm qua Corepack (đi kèm Node):

```bash
corepack enable          # Windows: cần mở terminal bằng quyền Administrator
pnpm -v                  # → 10.34.9
```

Nếu không có quyền admin, gọi trực tiếp: `corepack pnpm <lệnh>`.

## Bắt đầu

```bash
git clone https://github.com/ThanhDuc1712/EduCenter-Cloud---BTL-Cloud.git
cd EduCenter-Cloud---BTL-Cloud
pnpm install --frozen-lockfile
```

Trước khi code (người hoặc AI):

1. Đọc `ROADMAP.md` — §2.3 Decision Log, dòng task của mình ở §5, §7 Quy tắc làm việc, §8 Quality Gates.
2. Đọc file giao việc của mình trong `docs/handoff/<TÊN>.md`.
3. Kiểm tra code, contract (`packages/api-contract/`) và schema thực tế trên `main`.

## Git workflow (tóm tắt — chi tiết ở ROADMAP §7.4)

| Branch | Người dùng |
|---|---|
| `main` | Nhánh tích hợp — chỉ nhận PR đã review + test. Không push thẳng |
| `duc` · `doanh` · `anh` · `ha` · `duong` · `giang` | Branch cá nhân cố định của từng thành viên |

```bash
# Đồng bộ branch cá nhân với main mới nhất trước khi làm task mới
git switch <ten-ban>
git fetch origin
git merge origin/main

# Commit theo Conventional Commits, có Task ID
git commit -m "feat(students): list + pagination [P1-09]"

# Push branch cá nhân và mở PR vào main
git push origin <ten-ban>
gh pr create --base main --head <ten-ban>   # hoặc tạo PR trên GitHub
```

- Mở PR vào `main` khi xong **một task hoặc một batch task liên quan**, hoặc tại mốc bàn giao mà người khác đang phụ thuộc. Không gom toàn bộ phần việc cá nhân rồi mới merge.
- Điền đủ PR template; chờ review theo CODEOWNERS; **không tự merge**.

## Lệnh hiện có

| Lệnh | Tác dụng |
|---|---|
| `pnpm install --frozen-lockfile` | Cài dependency đúng lockfile |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` | Chạy script tương ứng trong mọi package có định nghĩa (bỏ qua package chưa có) |

Lệnh chạy local (API, web, PostgreSQL qua Docker Compose) sẽ được bổ sung khi P0-07, P0-10, P0-19 hoàn thành.
