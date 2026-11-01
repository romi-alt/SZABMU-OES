# 13 — Next Implementation Prompt (Phases 0 and 1 only)

> Work in `/home/user/SZABMU-OES`, branch `claude/oes-platform-foundation`. Do not rewrite anything listed under PRESERVE.
>
> **Step 1 — Baseline.** Review `git status`, run `run_secret_scanning`, commit the uncommitted work in logical commits, push, and confirm the GitHub Actions workflow in `.github/workflows/ci.yml` runs green (fix CI defects only). Do not open a PR.
>
> **Step 2 — Prove durability.** Add `apps/api/test/fault.test.ts` that starts the API as a child process against the test DB, saves answers for several candidates, SIGKILLs the API, restarts it, and asserts every acknowledged answer is present with the correct revision and that submit remains idempotent. Add a PG-restart case and a Redis-flush case. Add a Playwright test using the browser clock API proving a manipulated client clock does not change the deadline.
>
> **Step 3 — Authorisation inventory.** Add `apps/api/test/route-inventory.test.ts` that enumerates every registered route and fails if any lacks `@Perm`/`@Public`, and requires an allow-listed cross-campus test for every scoped `:id` route. Fix any gaps it finds.
>
> **Step 4 — Scale.** Add PgBouncer (transaction mode) to `docker-compose.yml` and pool settings to `prisma.service.ts`; extend `tests/load/exam-load.mjs` with multi-process targets, a login-storm mode and a `--kill-api-at` option. Write SLOs in `docs/load-test-plan.md` BEFORE running. Run 2,000 then 5,000 synthetic candidates; record measured results in `docs/implementation-status.md`. Do not state 10k/20k readiness.
>
> **PRESERVE (do not restructure):** `apps/api/src/modules/delivery/delivery.service.ts` save/submit/start SQL and invariants; `apps/web/src/exam-engine.ts`; `apps/api/prisma/migrations/*` (add new migrations only); `common/auth.ts` scope helpers; audit hash chain; frozen paper snapshots; four-eyes rules; existing 96 API + 15 shared + 13 e2e tests must stay green.
>
> **Rules:** synthetic data only; no production deployment; update `docs/implementation-status.md` honestly (completed / in-progress / blocked / untested); stop after Step 4 and report before starting Phase 2.
