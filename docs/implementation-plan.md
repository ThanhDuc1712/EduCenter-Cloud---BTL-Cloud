# Implementation plan — Phase 0 repository audit

Audit date: 2026-11-24 · Branch: `main` · Base commit: `56583b9` (working tree clean before the audit).

## 1. What the repository contained at audit time

| Area | Content found | Status |
|---|---|---|
| Monorepo | pnpm 10.34.9 workspace (`apps/*`, `packages/*`), Node 24 (`.nvmrc`), lockfile, `save-exact` | COMPLETED |
| `apps/api` foundation | NestJS 11 bootstrap, validated env config, JSON-lines logger, server-side request ID, bounded body parsing (raw body under `/api/v1/internal/*`), standard error body, helmet, deny-by-default guard, graceful shutdown, Prisma 7 client via pg adapter, runtime-role check | COMPLETED |
| `apps/api` health | `GET /api/v1/health` (readiness, DB ping) and `/health/live` | COMPLETED |
| `apps/api` tests | HTTP foundation tests, route inventory (every route must declare a policy), env validation, error filter, DB-role integration test | COMPLETED |
| Prisma schema | Generator + datasource only — **no models, no migrations** | NOT IMPLEMENTED |
| Business modules (students, teachers, courses, classes, schedule, enrollment, attendance, grades, tuition, notifications, reports, dashboard) | none | NOT IMPLEMENTED |
| Materials + cross-cloud pipeline | none (`functions/material-processor/.gitkeep` only) | NOT IMPLEMENTED |
| Auth (`paths/auth.yaml`, `me.yaml`) | Contract drafts only, not referenced from `openapi.yaml`; no code | NOT IMPLEMENTED — **out of scope by request** (no login/logout/register) |
| `packages/api-contract` | OpenAPI 3.1 root with health only; draft `students.yaml` references schemas that do not exist | PARTIALLY IMPLEMENTED |
| `packages/shared` | Error codes, header constants (ESM + CJS build) | COMPLETED |
| `apps/web` | Single health-check page, shadcn Button, typed `openapi-fetch` client, Vite proxy to API | PARTIALLY IMPLEMENTED (shell only) |
| `infra/local` | PostgreSQL 16 compose with `edu_migrator` / `edu_runtime` roles, dev Dockerfile | COMPLETED |
| `infra/azure`, `infra/aliyun` | `.gitkeep` only | NOT IMPLEMENTED |
| `docs` | `docs/handoff/*.md` (team plans), `docs/runbooks/local-dev.md` | PARTIALLY IMPLEMENTED |
| `tests/` | README + empty folders | NOT IMPLEMENTED |
| CI | `.github/workflows/ci.yml` (lint, typecheck, test, build, gitleaks) | COMPLETED (not modified — no CI/CD work requested) |
| Mock functionality | none found — there was nothing fake to remove | — |

### Windows check (performed)

`pnpm install --frozen-lockfile`, `pnpm --filter @educenter/shared build`, `pnpm lint`, `pnpm typecheck` all pass on
Windows 11 / PowerShell 5.1 / Node 24.22.3 / pnpm 10.34.9 / Docker 29.9.3. **No Windows blockers** in the existing code.
Note: Python is not installed on the audit machine; the Python Function Compute code is therefore tested inside a
`python:3.12-slim` Docker container (BLOCKED locally without Docker, never required for LOCAL mode).

## 2. Decisions for this implementation

| # | Decision | Reason |
|---|---|---|
| I-01 | **No login / session UI** (overrides ROADMAP D-24/D-28 for this phase). A backend-configured **demo context** supplies tenant + persona. The tenant is fixed by `DEMO_TENANT_SLUG`; the persona key is kept in an HMAC-signed, HttpOnly cookie and resolved server-side to a seeded admin / teacher / student record. The client never sends `tenantId` or `role`. Persona switching is only enabled when `DEMO_MODE=true`. | Explicit request |
| I-01b | **Login + registration added** (supersedes the "no login" part of I-01; implements the core of ROADMAP D-24 / P1-01). `users` (unique per tenant + email, Argon2id), `auth_sessions` (opaque token, SHA-256 stored), `login_attempts` (PostgreSQL limiter, D-06). Public sign-up creates a STUDENT account + new student profile only. `AUTH_MODE=session` (default) requires a session; `AUTH_MODE=demo` keeps the I-01 demo context as a fallback for requests without a session. Not done yet: admin-issued accounts with temporary password / `must_change_password` (D-28), CSRF token (P1-02 — Origin check + SameSite=Lax only). | Explicit request |
| I-02 | Cloud-operations APIs (`/api/v1/cloud/*`) use an `ops` policy: in production they additionally require the caller IP to be in `OPS_ALLOWED_CIDRS` (defence in depth behind App Service access restrictions). | Requirement: protect cloud admin APIs at infra/network level |
| I-03 | Every business table has `tenant_id`; `UNIQUE(tenant_id, id)` + composite foreign keys so a row can never reference another tenant's row (ROADMAP convention). | Tenant isolation at DB level |
| I-04 | Business endpoints are typed through TypeScript types in `apps/web/src/lib/types.ts` (server DTOs validate) instead of extending the OpenAPI document for ~100 operations. The OpenAPI document stays authoritative for health and the internal callback. | Time budget; documented deviation from ROADMAP §7.5 |
| I-05 | Provider abstraction: `StorageProvider` (LOCAL filesystem / Alibaba OSS), `ProcessingProvider` (LOCAL in-process worker, **labelled MOCK**, / Aliyun FC via OSS trigger), secrets (env + App Service Key Vault references, optional Key Vault metadata reader), monitoring (in-process metrics + optional Application Insights / Azure Monitor / SLS / CloudMonitor readers). | LOCAL vs CLOUD mode |
| I-06 | LOCAL processor does real PDF work with `pdf-lib` (validation, page count, metadata, first-page preview PDF) and calls the API back **through the same HMAC callback endpoint** used by Function Compute. | Exercise the security path locally |
| I-07 | Money stays `BIGINT` VND, serialized as string (D-12). Scores are `DECIMAL(5,2)`. | Existing decision |
| I-08 | Teacher double-booking: `SELECT … FOR UPDATE` on the teacher row + overlap check in the same transaction (D-18). Room conflicts are checked the same way. | Existing decision |
| I-09 | Reconciliation uses `pg_try_advisory_lock` and records runs in `background_job_runs` (D-32). | Existing decision |

## 3. Work order

1. Prisma schema v1 + first migration + seed (2 tenants, realistic Vietnamese demo data).
2. Backend foundation additions: demo context, role policies, tenant transaction helper, activity log, notifications.
3. Business modules: students, teachers, courses, rooms, classrooms (+ schedule slots, sessions, conflict checks), enrollments, attendance, assessments/grades, invoices/payments, notifications, dashboard, reports (+ CSV).
4. Materials: storage abstraction, upload policy, upload confirmation, state machine, HMAC callback, local worker, signed URLs, reconciliation.
5. Cloud integration adapters: OSS, Key Vault metadata, Application Insights, Azure Monitor, SLS, CloudMonitor, cost (NOT CONFIGURED when no billing access).
6. Function Compute `material-processor` (Python) + tests in Docker.
7. Frontend: layout, navigation (3 groups), all pages.
8. Infra scripts (Azure CLI / Aliyun CLI, PowerShell), Windows scripts.
9. Tests + documentation + completion report.

The final status of each item is recorded in `docs/completion-report.md`; test evidence in `docs/cloud-testing-report.md`.
