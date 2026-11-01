# 07 — Test results (final run on this branch HEAD, disposable DB/Redis only)
| Gate | Result |
|---|---|
| ESLint | exit 0 |
| Type-check (web) | clean |
| Build (shared, API, web) | OK |
| `@oes/shared` | 52 / 52 passed |
| `@oes/api` (incl. authorization, engine, campus isolation) | 260 / 260 passed (20 files) |
| Playwright e2e (real API + built web) | 70 / 70 passed |
| Fault suite (own infrastructure) | 17 passed, 1 skipped, exit 0 |

Note: running two API suites at once against the same disposable DB produces spurious failures (observed once, from my own overlapping runs); the numbers above are from sequential runs. The shared dev database was never used by tests.
