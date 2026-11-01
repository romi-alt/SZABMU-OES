# 02 — Git and build status

## Git (TODAY)

| Item | Value |
|---|---|
| Branch | `claude/oes-platform-foundation` |
| HEAD | `d85e3a31d0087b12c8376ae041aa62942b927c8a` |
| origin/claude/oes-platform-foundation | same commit (fetched) |
| Modified / untracked (start of audit) | none |
| Remote | `https://github.com/romi-alt/SZABMU-OES` (private) |

Last 15 commits (newest first): `d85e3a3` A/B harness · `47997bc` submit no longer 500s under connection pressure · `4fb82ee` status: load results · `f7b43fe` load driver `Math.max` fix · `e89daed` load driver enrolment/multi-API/CPU · `5392822` observability · `6c4944b` staff MFA · `6f2093f` production config/route manifest/key sweep · `2f002c0` verifiable backup · `b4d2813` fault-injection suite · `3c4f6ea` lecturer↔course authz · `8eed15e` eligibility/roster versions/overrides · `c1458fa` web logo · `c11db08` perf(delivery) · `c521f28` load driver.

## Processes at audit start (TODAY)

The container had restarted (uptime 15 min). Running: dev PostgreSQL 16 cluster `oes` (:5433) and dev Redis (:6390) only. **No load test, fault test, build or A/B bench was running.** The A/B bench had already completed (`/tmp/ab2.out`, EXIT 0); its monitors were stale. Nothing was terminated.

Latest 5,000-candidate run: completed, results saved in `docs/implementation-status.md` ckpt 9 (R3 PASS). R2 (the earlier 5,000 run) crashed in the report stage; fixed in `f7b43fe`. The raw `/tmp/load-r*.out` files still exist.

Dev database hygiene: `szabmu_oes` holds **12,023 users / 12,012 students / 12,000 attempts** and three `LOAD-*` exams in `LIVE` status left by load tests. It is shared dev data; the Playwright global-setup would `--reset` it, so Playwright was **not** run against it (see below).

## Commands run (TODAY) — `COMMAND · EXIT · RESULT`

| Command | Exit | Result |
|---|---|---|
| `node -v` | 0 | v26.13.0 (`engines >=26`) |
| `npm run typecheck` (shared build + api `tsc` + web `tsc`) | 0 | clean; Prisma client regenerated |
| `npm run lint` (`eslint .`) | **1** | **6 errors**, all in `apps/api/test-fault/bench-main.cjs` (`require`/`process`/`console` `no-undef`, lines 4-12): a CommonJS file without a Node globals override in `eslint.config.mjs`. Added in commit `d85e3a3`. CI lint would be red. |
| `npm run build` (shared + api + web) | 0 | Next 16 production build, 23 routes, compiled in 7.7 s |
| `npm run test -w @oes/shared` | 0 | 15/15 |
| `npx vitest run` in `apps/api` | 0 | 12 files, **171/171** in 71.8 s. Two logged `Connection terminated unexpectedly` lines come from `metrics.test.ts` DB-down cases (expected). |
| `npm run test:fault` | **1** | 2 files passed, 1 skipped (`start-ab`, needs `RUN_BENCH=1`); **10 passed, 1 skipped**; exit 1 from 1 *unhandled* error: `Connection terminated unexpectedly` from `pg` (harness `DisposablePg.pool()` has no `'error'` listener; thrown when the test crashes the DB). Assertions are green; the run is red. |
| Playwright 17 specs, against a **disposable** PG/Redis/API/web (env override + `redis-cli` shim; dev DB confirmed untouched, still 12,023 users) | **1** | **16 passed, 1 failed** — `staff.spec.ts:51` invigilator spec. Cause: `auth.spec.ts:70` enables MFA on `invigilator.b` and never disables it; the later spec logs in as the same user and lands on `/mfa` (`helpers.ts:11` expects `/dashboard`). |

Not run: `npm audit` (HISTORICAL: 11 moderate, dev-only, see `docs/security-triage.md`); `npm install` (lockfile untouched, not required); `docker compose` / CI workflow (no Docker available/CI not executed).

## Environment checks (TODAY)

- API connected to disposable PostgreSQL 16 (127.0.0.1:54399) and Redis (:6399); `/api/health` → `{"status":"ok","db":true,"redis":true}`.
- Next.js `next start` served `/login` 200 and all authenticated routes listed in `04-frontend-functional-audit.md`.
- Dev DB (`:5433`) and dev Redis (`:6390`) were **not** modified by this audit. The disposable stack lives under `/tmp/audit-live` and is stopped at the end of the audit.
