# 10 — Test Execution Results

Environment: Linux container, Node v26.13.0, PostgreSQL 16 on :5433 (accepting), Redis on :6390 (PONG). API tests use `szabmu_oes_test` DB and Redis db 1. Data: synthetic only.

| Command | Executed today | Exit | Result |
|---|---|---|---|
| `npm run typecheck` | yes | 0 | clean (shared, api, web) |
| `npx eslint .` | yes | 0 | clean |
| `npm test` → shared | yes | 0 | 15 passed |
| `npm test` → api | yes | 0 | 96 passed (exam-engine 20, auth 11, security 50, workflow 15); 0 failed, 0 skipped |
| `npm run build` | not re-run | – | passed last session |
| Playwright (13 tests: auth 6, exam 3, staff 4) | **not run** — global setup re-seeds the dev DB (`--reset`) | – | 13 passed last session; stale evidence |
| `npm run test:load` | **not run** — provisions candidates in DB, heavy | – | results in 09 are from last session |

## What the tests do and do not prove
- 96 API tests hit real PG/Redis through Fastify inject: strong evidence for engine invariants, RBAC, scope, workflow rules.
- **Not covered:** API/PG crash recovery; multi-process API; Redis outage; clock-manipulation; accessibility; mobile; real SMTP; Docker image build; CI execution; any route added without a matching test (no route inventory test); coverage % is not measured (no coverage tool configured) — test count alone is not a quality claim.
- E2E runs Chromium only.
