<!--
PR template (ROADMAP §7.4, §7.7, §7.8). The PR replaces task cards and per-task handoff files (D-34).
Only paste test output you actually ran — "tests passed" without a real run is not accepted.
-->

## Task

- **Task ID(s):** <!-- e.g. P0-06, or a related batch: P1-01 + P1-02 -->
- **Branch → main:** <!-- duc / doanh / anh / ha / duong / giang -->
- **Summary:** <!-- what this PR does, in 1–3 sentences -->

## Scope

- **Files / modules changed:** <!-- must stay within the task's "Module/File" column (ROADMAP §5) -->
- **Dependencies (merged?):** <!-- Task IDs this relies on; confirm each is on main -->
- **Contract impact (`packages/api-contract`):** <!-- none / yes — contract PR merged first? (TV1 approves) -->
- **Schema / migration impact (`apps/api/prisma`):** <!-- none / yes — label `migration`, TV4 approves -->
- **New dependencies:** <!-- none / name@version + reason -->

## Tests actually run

```text
# command → real result (paste the summary lines)
pnpm lint            →
pnpm typecheck       →
pnpm test            →
pnpm test:integration →
```

## Security risks & mitigation

<!-- authz / tenant scope / secrets / logging / input validation — or "none identified" with reason -->

## Handoff

- **Status:** <!-- Done / Partial / Blocked -->
- **New or changed decisions (Decision Log §2.3):** <!-- none / D-xx proposed change -->
- **Out of scope / follow-ups:**
- **Notes for the next person or AI agent:**

## Reviewer checklist (ROADMAP §7.8)

- [ ] Only files within the task's allowed paths; no unexplained new dependency.
- [ ] Every new route has a policy (`@Policy` / `@InternalHmacPolicy`); tenant scope comes from the session, never `tenant_id`/`role` from the body.
- [ ] Negative tests exist (wrong tenant, wrong role, wrong owner) and they fail when the guard is removed.
- [ ] Transactions are correct; no network/Aliyun calls inside a transaction; concurrency handled (lock/version/unique).
- [ ] No tokens, signed URLs, passwords or PII in logs; errors do not expose stack traces or DB details.
- [ ] No secrets; configuration comes from env / Key Vault.
- [ ] No string-built raw SQL; no shell commands containing user input.
- [ ] Test results above match the CI log.
- [ ] Contract/schema changes went through their own PR.
