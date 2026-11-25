# EduCenter Cloud

Multi-tenant B2B SaaS for education centers (Admin / Teacher / Student).
Modular monolith: NestJS API + React SPA on PostgreSQL, contract-first (OpenAPI) and schema-first (Prisma).

Coordination, decisions and task scope live in `ROADMAP.md` (§2.3 Decision Log, §5 tasks, §7 working rules).
`ROADMAP.md` (repo root) is maintained by TV1; each member's task handoff is `docs/handoff/<NAME>.md` (D-34).
Changes reach `main` only through pull requests using `.github/pull_request_template.md` (§7.4, §7.7).

Toolchain: Node.js 24 LTS (`.nvmrc`) and pnpm 10.34.9 (`packageManager`) — see the runbook.

## Layout

```
apps/
  api/                 NestJS 11 (Express) — /api/v1, Prisma 7 (pg adapter)
    src/common/        config validation, logging, request ID, body parsing, errors, authz, prisma
    src/health/        GET /api/v1/health (readiness) · /health/live (liveness)
    prisma/            schema.prisma (owner TV4) · migrations
    test/              HTTP foundation, route inventory, integration (DB) tests
  web/                 React 19 + Vite 8 + Tailwind 4 + shadcn/ui; typed client from the contract
packages/
  api-contract/        OpenAPI 3.1 (openapi.yaml + paths/<module>.yaml) → generated/schema.d.ts
  shared/              framework-agnostic constants (error codes, header names)
functions/             material-processor (Aliyun Function Compute, Python 3.12)
infra/local/           PostgreSQL init (DB roles, D-25) · dev Dockerfile
infra/azure/ · aliyun/ Bicep, DB roles, RAM policies, OSS lifecycle/CORS
scripts/windows/       PowerShell: check, setup, start, stop, test, deploy-azure, deploy-aliyun
docs/handoff/          personal handoff files (one per member, D-34)
docs/runbooks/         local-dev.md
tests/                 cross-cutting suites (security, load, e2e) — added by later tasks
.github/               CI workflow, PR template, CODEOWNERS
ROADMAP.md             coordination: decisions, tasks, working rules, gates
docker-compose.yml     local PostgreSQL 16 (+ optional api/web profile)
```

## Quick start (Windows, PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\setup-local.ps1   # .env, install, PostgreSQL (Docker), migrate, seed
powershell -ExecutionPolicy Bypass -File scripts\windows\start-local.ps1   # http://localhost:5173
powershell -ExecutionPolicy Bypass -File scripts\windows\test-local.ps1    # all quality gates
```

Sign in at `/login` (seeded accounts, e.g. `admin@hanoi-center.edu.example` / `Demo@12345`, center `hanoi-center`) or create a student account at `/register` — see [docs/local-development.md](docs/local-development.md#đăng-nhập--đăng-ký). With `AUTH_MODE=demo` the old demo persona switcher is still available.
LOCAL MODE needs no cloud credentials (storage and processing are local and labelled MOCK).

## Documentation

| Topic | File |
|---|---|
| Audit & plan | [docs/implementation-plan.md](docs/implementation-plan.md) |
| Local / Windows | [docs/local-development.md](docs/local-development.md), [docs/windows-setup.md](docs/windows-setup.md) |
| Education modules, DB, API | [docs/education-modules.md](docs/education-modules.md), [docs/database-architecture.md](docs/database-architecture.md), [docs/api-architecture.md](docs/api-architecture.md) |
| Cloud | [docs/cloud-architecture.md](docs/cloud-architecture.md), [docs/azure-integration.md](docs/azure-integration.md), [docs/aliyun-integration.md](docs/aliyun-integration.md), [docs/cross-cloud-data-flow.md](docs/cross-cloud-data-flow.md) |
| Operations | [docs/cloud-security.md](docs/cloud-security.md), [docs/cloud-monitoring.md](docs/cloud-monitoring.md), [docs/cloud-recovery.md](docs/cloud-recovery.md) |
| Status | [docs/cloud-testing-report.md](docs/cloud-testing-report.md), [docs/completion-report.md](docs/completion-report.md) |

## Foundation guarantees (do not weaken)

- Config validated at startup; missing/invalid env → process exits non-zero (values never logged).
- Deny-by-default authorization: a route without an explicit policy returns 403; a test fails if any route lacks one.
- Standard error body `{ code, message, requestId, fieldErrors? }`; no stack traces, SQL or constraint names.
- Server-generated `X-Request-ID` on every response and in every log line (JSON lines).
- DTO validation: `whitelist` + `forbidNonWhitelisted` + `transform`.
- JSON bodies bounded; raw body only under `/api/v1/internal/*` (HMAC callbacks).
- No CORS (same-origin, D-03); helmet security headers; no `x-powered-by`.
- App connects as `edu_runtime` (no superuser, no BYPASSRLS, no DDL); migrations as `edu_migrator`.
- Unsafe raw SQL (`$queryRawUnsafe` / `$executeRawUnsafe`) is a lint error.
