# Black-box QA suites (tester: Dương)

Run against a **running** deployment — local (`scripts\windows\start-local.ps1`) or the Azure demo.
They only use the public HTTP API, like a real browser would. No app code is touched.

## One command

```powershell
# local (seed password defaults to Demo@12345)
powershell -ExecutionPolicy Bypass -File tests\run-qa.ps1

# Azure demo (asks for the demo password; read-only)
powershell -ExecutionPolicy Bypass -File tests\run-qa.ps1 -BaseUrl https://<app>.azurewebsites.net
```

Name a run and keep it as evidence in the repo:

```powershell
powershell -ExecutionPolicy Bypass -File tests\run-qa.ps1 -RunName pre-aliyun-service-available -Archive
```

`-Archive` copies the reports to `docs\evidence\qa\<date>-<RunName>-<target>\` and adds one row to
`docs\evidence\qa\README.md` (the run log). Without it, results stay only in
`..\EduCenter-test-results\<date>-<RunName>-<target>-<sha>\` (outside the repo): `SUMMARY.md`,
one `.md` + `.csv` per suite, one `.log` per suite. No cookies, tokens, passwords or response bodies are stored.

| Suite | File | What it proves |
|---|---|---|
| Security suite | `tests/security/security-suite.mjs` | ~30 checks: headers, error bodies, login enumeration, ST10 brute force (429), cookie flags, logout revocation, CSRF/Origin, admin-only routes, tenant isolation by id, BUG-02 regression, input validation, oversized body, forged FC callback, signed storage token |
| Authz matrix | `tests/security/authz/authz-matrix.mjs` | every route × 8 actors × own/other/other-tenant ids |
| Role journeys | `tests/e2e/role-journeys.mjs` | Admin / Teacher / Student walk their screens with real login; scope checks; p50/p95 of the GETs |
| k6 smoke | `tests/load/smoke.k6.js` | 5–30 VUs read mix, p95 / error-rate thresholds. Needs k6 (`winget install k6 --source winget`) |

## Result meaning

- **PASS / FAIL** — verdict against the expected behaviour (ROADMAP + design V2 §6.2).
- **INFO** — behaviour recorded, needs a team decision (marked "CHỜ DEV"). Not a pass, not a fail.
- **SKIP** — not applicable on this target (e.g. write checks are local-only; default-password check is Azure-only).

## Safety rules

- Checks that send writes run **only when BASE_URL is localhost**, and only requests that must be rejected.
  After a local run you can reset data with `scripts\windows\setup-local.ps1`.
- The brute-force check locks a **non-existent** e-mail, never a real account.
- k6 is capped at 30 VUs; anything bigger needs an agreed benchmark window (cost + demo stability).
- `tests/e2e/integration-flow.mjs` (dev suite) needs `AUTH_MODE=demo` — see BUG-01.
