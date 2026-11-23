# Local development runbook (P0-19)

Target: a new member runs the stack locally in ≤ 15 minutes. Local only — no cloud resources,
credentials or real data are involved.

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | **24 LTS** (`.nvmrc`, `engines: >=24 <25`, D-20) | `node -v` → `v24.x` |
| pnpm | **10.34.9** (`packageManager`) | `pnpm -v` (or `corepack enable`) |
| Docker Desktop | with Compose v2 | `docker compose version` |

Node 24 is required, not just recommended: pnpm only *warns* (`WARN Unsupported engine`) on other
versions and continues, so check `node -v` before installing. With a version manager, run
`fnm use` or `nvm use` in the repo root (both read `.nvmrc`). On Windows, a system-wide Node in
`C:\Program Files\nodejs` can shadow the version manager if fnm's shell setup is not loaded
(`fnm env --use-on-cd` in your shell profile) — `node -v` is the source of truth.

## First-time setup

```bash
pnpm install                      # one lockfile at the repo root
cp .env.example .env              # then replace every change-me-* value (any random strings)
pnpm db:up                        # PostgreSQL 16 on 127.0.0.1:5433, roles created on first start
pnpm --filter @educenter/shared build
pnpm db:generate                  # Prisma client (apps/api/src/generated, git-ignored)
```

The DB init script (`infra/local/postgres/init/01-roles.sh`) runs **only when the volume is empty**.
It creates `edu_migrator` (schema owner, migrations) and `edu_runtime` (DML only — the app's role), D-25.
If you change the role passwords in `.env` later, recreate the volume (see "Reset").

## Daily start

```bash
pnpm db:up            # if not already running
pnpm dev              # api on :3000 (watch) + web on :5173 (Vite)
```

Open http://localhost:5173 — the page calls `GET /api/v1/health` through the Vite proxy
(same-origin, D-03; CORS is deliberately disabled on the API).

Direct checks:

```bash
curl -i http://localhost:3000/api/v1/health        # 200 {"status":"ok","checks":{"app":"up","database":"up"}}
curl -i http://localhost:3000/api/v1/health/live   # liveness, no DB
```

## Shutdown

```bash
# Ctrl+C in the `pnpm dev` terminal, then:
pnpm db:down          # stops containers; data is kept in the `educenter_pgdata` volume
```

## Full stack in containers (optional)

```bash
docker compose --profile app up -d --build    # postgres + api + web (dev image, no hot reload)
docker compose --profile app down
```

## Quality commands

`typecheck` and `test` import the built `@educenter/shared` package: on a fresh clone run
`pnpm --filter @educenter/shared build` (part of first-time setup) or `pnpm build` first, otherwise
they fail with `Cannot find module '@educenter/shared'`.

```bash
pnpm lint
pnpm typecheck
pnpm test                 # unit + HTTP foundation tests (no DB needed)
pnpm test:integration     # needs `pnpm db:up`; runs as edu_runtime and asserts it is not superuser
pnpm build
pnpm contract:lint        # OpenAPI lint (Redocly)
pnpm contract:generate    # regenerate packages/api-contract/generated (committed, D-36)
```

## Migrations

`pnpm db:migrate` runs `prisma migrate dev` as `edu_migrator` (`MIGRATION_DATABASE_URL`).
Schema changes belong to TV4 (ROADMAP §7.1, D-27); do not edit `schema.prisma` outside that flow.

## Reset (destroys local data)

```bash
docker compose down -v    # removes the pgdata volume; next `pnpm db:up` re-runs the role init
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ports are not available ... 5433` | Another service uses the port: set `POSTGRES_HOST_PORT` and the port in both URLs in `.env`. |
| API exits with `Invalid environment configuration: X` | Variable `X` missing/invalid in `.env`. Values are never printed. |
| `/api/v1/health` returns 503 | DB not reachable: `docker compose ps`, check `DATABASE_URL`. |
| `password authentication failed for user "edu_runtime"` | Passwords changed after the volume was created → reset (above). |
| `WARN Unsupported engine` from pnpm | You are not on Node 24 — `fnm use` / `nvm use` (reads `.nvmrc`) or install Node 24 LTS. |
| `Cannot find module '@educenter/shared'` in typecheck/test | Build it first: `pnpm --filter @educenter/shared build`. |
