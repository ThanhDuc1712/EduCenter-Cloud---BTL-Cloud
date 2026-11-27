# QA run log

Every row is one run of `tests\run-qa.ps1 -Archive`. Folders hold the raw reports (no secrets).

| Run | Date | Target | Commit | Security | Authz | E2E | k6 |
|---|---|---|---|---|---|---|---|
| [20261127-2200-pre-aliyun-service-available-local](20261127-2200-pre-aliyun-service-available-local/SUMMARY.md) | 2026-11-27 22:00 | local | `c73c3b4` | FAIL: PASS 23  FAIL 1  INFO 3  SKIP 1 | FAIL | PASS: 34/34 steps passed | NOT RUN: chua cai k6 |
| [20261127-2220-fix-bug-01-02-local](20261127-2220-fix-bug-01-02-local/SUMMARY.md) | 2026-11-27 22:20 | local | `c73c3b4` | PASS: PASS 24  FAIL 0  INFO 3  SKIP 1 | PASS | PASS: 34/34 steps passed | NOT RUN: chua cai k6 |
| [20261128-0044-local-k6-smoke-local](20261128-0044-local-k6-smoke-local/SUMMARY.md) | 2026-11-28 00:44 | local | `3de6429` | PASS: PASS 24  FAIL 0  INFO 3  SKIP 1 | PASS | PASS: 34/34 steps passed | NOT RUN: chua cai k6 |
| [20261128-0052-local-materials-covered-local](20261128-0052-local-materials-covered-local/SUMMARY.md) | 2026-11-28 00:52 | local | `3de6429` | PASS: PASS 24  FAIL 0  INFO 3  SKIP 1 | FAIL | PASS: 34/34 steps passed | NOT RUN: chua cai k6 |
| [20261128-0101-fix-bug-03-local](20261128-0101-fix-bug-03-local/SUMMARY.md) | 2026-11-28 01:01 | local | `3de6429` | PASS: PASS 25  FAIL 0  INFO 3  SKIP 1 | PASS | PASS: 34/34 steps passed | NOT RUN: chua cai k6 |
| [20261128-0113-azure-main-224df33-azure](20261128-0113-azure-main-224df33-azure/SUMMARY.md) | 2026-11-28 01:13 | azure | `6337f21` | PASS: PASS 22  FAIL 0  INFO 5  SKIP 2 | ERROR | PASS: 34/34 steps passed | FAIL |
| [20261128-0121-azure-main-224df33-r2-azure](20261128-0121-azure-main-224df33-r2-azure/SUMMARY.md) | 2026-11-28 01:21 | azure | `6337f21` | PASS: PASS 22  FAIL 0  INFO 5  SKIP 2 | FAIL | PASS: 34/34 steps passed | PASS |
| [20261128-0143-fix-inactive-ip-local](20261128-0143-fix-inactive-ip-local/SUMMARY.md) | 2026-11-28 01:43 | local | `3e4f226` | PASS: PASS 26  FAIL 0  INFO 2  SKIP 1 | PASS | PASS: 34/34 steps passed | PASS |
