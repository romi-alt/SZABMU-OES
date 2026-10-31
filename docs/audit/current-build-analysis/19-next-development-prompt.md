# 19 — Next Claude Code implementation prompt (ready to execute — NOT executed)

```
You are continuing the SZABMU/PIMS Online Examination System on branch claude/oes-platform-foundation
(repo romi-alt/SZABMU-OES). Read docs/audit/current-build-analysis/ (esp. 01, 08, 16, 18) and
docs/implementation-status.md first. Evidence rules: label TODAY / HISTORICAL / NOT RUN; never claim a
module complete unless frontend + backend + persistence + permissions + tests work together; do not claim
pilot readiness. Synthetic data only. No merge to main, no PR, no production deployment, no production DB
changes. Destructive/fault tests only on disposable infrastructure created under /tmp (see
apps/api/test-fault/harness.ts); never touch the shared dev DB :5433 or Redis :6390 except via the
dedicated test database.

WORK IN THIS ORDER, one logical commit per step, with a regression test written first, the smallest fix,
the full suite run, and docs/implementation-status.md updated at each checkpoint:

STEP 0 (repo hygiene)
 a. Fix `npm run lint` (D-10) — eslint override for apps/api/test-fault/*.cjs.
 b. Fix Playwright order-coupling (D-11a): the MFA spec must use its own staff user or disable MFA in finally.
 c. Fix test:fault exit code (D-11b): attach 'error' handlers to harness pools/clients.
 d. Fix D-09: scope GET /reports/institutions by campus; add a test that, for every list/aggregate route,
    runs as campus-A and asserts no campus-B identifier is present.
 Exit criteria: lint, typecheck, build, API tests, fault tests, Playwright all exit 0, twice in a row.

STEP 1 (D-01, D-02) EXAM CONTROL + LIFECYCLE RESILIENCE
 - Add ExamStatus SUSPENDED (+ migration, additive). Operations (all audited with mandatory reason, idempotent,
   state-machine validated, role-checked: CCE/Super Admin exam-wide; campus-scoped invigilator/admin for
   their campus only): suspend, resume, open admission, close admission, extend (exam-wide, per-campus,
   selected candidates; capped), initiate scoring.
 - Server-authoritative time: paused duration must be excluded from candidate deadlines (DB clock);
   heartbeats deliver pause/resume/extension to clients; saves are refused while suspended with a clear code;
   the player shows a suspended screen and resumes without losing state.
 - Make the lifecycle tick DB-driven (pg advisory-lock leader) so auto-submit, LIVE/CLOSED, absentees and
   RESULT_PENDING do not depend on Redis; finalise in bounded parallel batches; export tick-age metric and
   an alert.
 - Tests: state-machine unit tests; API tests per operation (authorization incl. campus A vs B, idempotency,
   concurrency with saves and the sweeper); fault tests on disposable infra (Redis down at deadline, worker
   killed mid-tick, two workers, 5,000 mass expiry); Playwright: examiner create→approve→schedule→monitor→
   suspend→resume→extend→close→publish with an invigilator and a candidate.

STEP 2 (D-04) MONITOR AT SCALE
 - Bounded, campus-scoped, paginated monitor API with a maintained answered-count; keep polling as the
   baseline; add SSE only if measured necessary. Load test: 20 monitor clients polling during a saving
   population; assert save p99 does not regress.

STEP 3 (D-03) MEASURE BEFORE OPTIMISING
 - On disposable, separated processes (and hosts where available): 2,000 and 5,000 candidates ×3 runs each,
   login storm with argon2, submit wave after commit 47997bc, with /api/metrics and pg_stat_statements
   captured. Report medians and ranges; attribute bottlenecks only from profiles. Update the load tables.

STEP 4 (D-05) OPERATIONS
 - Scheduled, encrypted, off-site-capable backups and a restore drill with measured timings (scripts +
   runbook); run Prometheus + Alertmanager locally and fire every alert in infra/observability/alerts.yml
   once; document results.

STEP 5 UX
 - Responsive shell (collapsible nav at <1024px), mobile player palette (drawer), error.tsx/not-found.tsx/
   loading.tsx, favicon, centralised notification deep-link builder with a test that every link resolves to
   an existing route, CSP for the web app; add Playwright projects at 390 and 768 px; add an axe run.

FINAL REPORT (required): git status, commit hashes, push confirmation (branch only), files changed, security
scan, tests run with exact counts and exit codes (TODAY vs HISTORICAL), unresolved risks. Do not claim pilot
readiness. Do not skip testing.
```
