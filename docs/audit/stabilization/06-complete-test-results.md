# 06 — Complete test results

Code under test: `claude/oes-platform-foundation` @ **`b987a7c`** (documentation commit follows it). Node v26.13.0, Linux, one sandbox. Both runs below were executed by `/tmp/stab-regress.sh` (sequential, one log per command).

## Final run (all green) — TODAY

| # | Command | Environment | Exit | Result |
|---|---|---|---|---|
| 1 | `npm run typecheck` (shared build + api `tsc` + web `tsc`) | — | **0** | clean |
| 2 | `npm run lint` (`eslint .`) | — | **0** | clean (was 6 errors) |
| 3 | `npm run build` (shared + api + web; web is a Next 16 production build, all routes dynamic, Proxy registered) | — | **0** | frontend and backend build |
| 4 | `npm run test -w @oes/shared` | — | **0** | 2 files, **23/23** (15 rules + 8 browser-safety guards) |
| 5 | `npx vitest run` in `apps/api` (integration, authorization, security) | dedicated test DB `szabmu_oes_test`, Redis DB 1 | **0** | 14 files, **194/194** (was 171; +17 campus isolation, +4 notification links, +2 workflow notification checks) |
| 6 | `npx playwright test` (run 1) | disposable PostgreSQL :54397 + Redis :6397 + API/web started by Playwright (production web build) | **0** | **29/29** |
| 7 | `npx playwright test` (run 2, same command, fresh seed) | same | **0** | **29/29** — consistent |
| 8 | `npm run test:fault` | harness-created disposable PostgreSQL/Redis | **0** | 3 files passed, 1 skipped; **14 passed**, 1 skipped (`start-ab`, needs `RUN_BENCH=1`) |

The 29 browser specs: 17 pre-existing + all-questions (1) + CSP/favicon (4) + notifications (1) + errors (6).

## First full run (failed) — kept for the record — TODAY

Same script, immediately after the feature commits and before the last fixes:

| Command | Exit | Result | Cause (both mine) |
|---|---|---|---|
| API tests | **1** | 193/194; `exam-engine.test.ts › a save racing a submit…` → `answerDigest is not a function` | the test imported `answerDigest` from the barrel that I had just removed it from. My earlier targeted API runs did not include this file; the full run caught it. Fixed (import from `@oes/shared/server`). |
| Playwright run 1 and 2 | **1** and **1** | 28/29 both times (deterministic) | `staff.spec › CCE withdraws a candidate admission…` waits for a "Withdraw…" button on `DMC-B-2024-0006` (`student.b006`). My new all-questions spec submitted as `b006`, and the exam page hides that button after submission: **I had introduced the order-dependence I was asked to remove.** All 10 seeded candidates were already claimed, so the browser seed now creates 8 per campus; all-questions uses `b007`, CSP uses `b008`. |
| typecheck, lint, build, shared, fault | 0 | pass | — |

## Targeted evidence gathered along the way — TODAY

| Check | Result |
|---|---|
| Campus-isolation tests before the fix | 13/13 failed (the leak was real and detected) |
| …after the fix | 15/15, later 17/17 |
| Harness self-test | 4/4; an unexpected connection error with all assertions passing → run fails (proof, throwaway test deleted) |
| Browser-safety guard | fails when `node:crypto` is re-imported in the barrel (proof, reverted) |
| Notification link tests | fail when a dead link is re-introduced (proof, reverted) |
| MFA spec / invigilator spec | alone: pass; together: pass; reverse order: not forceable with this runner |
| CSP | production header on real responses; 0 violations across the exercised flows |

## Safety record

- Shared dev database: 12,023 users / 12,000 attempts before and after; **not migrated, seeded or written** by this phase. No Prisma migration was added (`git diff bfece18..HEAD -- apps/api/prisma` is empty).
- Dev Redis (:6390): never flushed (the Playwright global-setup's `redis-cli flushall` was redirected to the disposable Redis by a shim on `PATH`).
- After the runs: no leaked `postgres`/`redis-server`/`next-server`/`node dist/main.js` processes other than the shared dev services; no `/tmp/oes-fault-*`, `oes-bk-*`, `oes-restore-*` directories; the disposable stack was stopped and removed. No `pkill -f` was used.
- A verified restore of the dev database backup exists at `/tmp/stab-backup` (outside the repository).

## Not run in this phase

Load tests (by instruction); `npm audit`; accessibility audit; Firefox/WebKit; `RUN_BENCH=1` A/B bench; Docker/CI workflow.
