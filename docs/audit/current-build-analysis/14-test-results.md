# 14 — Test results

All "TODAY" results were produced by this audit on 2026-10-31. Environments: API tests → dedicated test database (`szabmu_oes_test`, Redis DB 1) on the shared dev PostgreSQL/Redis; fault/backup tests → disposable PostgreSQL/Redis created under `/tmp` by the harness (hard guard refuses `:5433`/`:6390`); Playwright → disposable PostgreSQL/Redis/API/web (env override; `redis-cli` shim so the global-setup flush hit the disposable Redis; dev DB verified unchanged afterwards at 12,023 users).

| Suite | Command | Passed | Failed | Skipped | Exit | Notes |
|---|---|---|---|---|---|---|
| Shared unit | `npm run test -w @oes/shared` | 15 | 0 | 0 | 0 | scoring, deadline, digest, permissions |
| API integration + security | `npx vitest run` (apps/api) | **171** | 0 | 0 | 0 | 12 files, 71.8 s: auth, config(22), course-access(13), eligibility(15), exam-engine, key-confidentiality(2), metrics(8), mfa(10), route-inventory(3), security, submit-contention(1), workflow |
| Fault + backup | `npm run test:fault` | **10** | 0 | 1 (`start-ab`, needs `RUN_BENCH=1`) | **1** | Failure is not an assertion: 1 *unhandled error* "Connection terminated unexpectedly" from the harness's own `pg.Pool` (`harness.ts:59`, no `'error'` handler) during "no acknowledged answer is lost across a database crash…". Treat the suite as green on assertions, red as a CI job (D-11). |
| Browser (Playwright) | `npx playwright test` | **16** | **1** | 0 | **1** | Failed: `staff.spec.ts:51` invigilator monitor — after `auth.spec.ts:70` enrolled `invigilator.b` in MFA, the login helper's `toHaveURL(/dashboard/)` sees `/mfa`. Test-order coupling, not a product defect. |
| Typecheck | `npm run typecheck` | – | – | – | 0 | |
| Lint | `npm run lint` | – | 6 errors | – | **1** | `bench-main.cjs` globals (D-10) |
| Build | `npm run build` | – | – | – | 0 | |

## Not run (with reasons)

- `RUN_BENCH=1` A/B bench (already run earlier today: results quoted in `07`/`12`).
- Load tests (instruction: do not launch a new large test automatically).
- `npm audit` (network-dependent, HISTORICAL only).
- Docker compose / GitHub Actions workflow (no Docker/CI run available).
- Accessibility (axe), mobile Playwright projects (not present in the repo).
- Playwright against the shared dev database (it would `--reset` it).

## Historical results (not counted as today's)

- 170/170 API tests and 17/17 Playwright in `implementation-status.md` (the 17/17 claim is **not reproduced**: 16/17 today).
- Load results in `12`; 5,000-candidate integrity PASS.
- Submit-fix regression (14×500 → 0) was observed when the fix was made; `submit-contention.test.ts` passes today.

## What the tests do and do not prove

They prove the engine's invariants, authorization decisions, backup/restore and key-confidentiality on **synthetic data, one machine**. They do not prove: behaviour under the sweeper being down, monitor performance, UI at mobile size (no tests), cross-browser behaviour (Chromium only), long-run soak, or any production deployment. Counting test quality: strong on durability and authz; thin on UI interaction (17 specs, desktop only), operator workflows (no browser spec for create-exam → schedule → publish), and failure of background workers.
