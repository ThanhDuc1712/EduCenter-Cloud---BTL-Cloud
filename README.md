# EduCenter Cloud

Multi-tenant B2B SaaS for education centers (Admin / Teacher / Student).
Modular monolith: NestJS API + React SPA on PostgreSQL, contract-first (OpenAPI) and schema-first (Prisma).

Coordination, decisions and task scope live in `ROADMAP.md` (§2.3 Decision Log, §5 tasks, §7 working rules).
`ROADMAP.md` is maintained by TV1 and is not yet stored in this repository.

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
infra/local/           PostgreSQL init (DB roles, D-25) · dev Dockerfile
docs/runbooks/         local-dev.md
tests/                 cross-cutting suites (security, load) — added by later tasks
docker-compose.yml     local PostgreSQL 16 (+ optional api/web profile)
```

## Quick start

See [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md).

```bash
pnpm install && cp .env.example .env   # fill in change-me-* values
pnpm db:up && pnpm --filter @educenter/shared build && pnpm db:generate
pnpm dev                               # http://localhost:5173
```

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
