# Cross-cutting test suites

Module unit tests live next to the code (`*.spec.ts`); API integration tests in `apps/api/test/`.
This folder is reserved for suites spanning modules, created by their tasks (ROADMAP §5, §7.3):

- `tests/security/` — ST01–ST25 (P1-19, P3-03)
- `tests/load/` — k6 scripts LT01–LT12 (P1-21, P2-18)
- `tests/poc/` — cross-cloud PoC scripts (P0-18, cloud track — out of scope for local foundation)
