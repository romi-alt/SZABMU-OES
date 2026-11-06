# Implementation tracker — 2026-11 transformation programme

Status labels (truthful only): **Not started · In progress · Implemented, unverified · Verified · Blocked · Deferred.**
"Verified" means a test that failed on the old code (or an executed measurement) now passes; the evidence column names it.
Branch `claude/oes-platform-foundation`, from commit `d6f297f`. **Nothing has been merged to `main` or deployed** (merging deploys; needs approval).

## 1. Tasks

| ID | Pri | Description | Files changed | Tests / evidence | Result | Remaining risk | Status |
|---|---|---|---|---|---|---|---|
| T-SEC-07 | P0 | TOTP brute-force via parallel requests | `modules/auth/mfa.service.ts`, `auth.service.ts` | `audit-hardening.test.ts` SEC-07 (failed before: 0/40 refused); `mfa.test.ts` | pass | none known | Verified |
| T-SEC-06 | P0 | Sign-up code brute-force via parallel requests (student + teacher) | `registration.service.ts`, `teacher-registration.service.ts` | SEC-06 (failed before: correct code accepted after 30 guesses) | pass | teacher path: dedicated test `audit-hardening.test.ts` "SEC-06 (teacher path)" added 2026-11-06 — failed on the pre-fix service (correct code accepted after 30 wrong guesses, HTTP 200), passes now | Verified (student and teacher) |
| T-SEC-03/04/05 | P0 | Reset-code guess race, per-address code limit, audit role | `auth.service.ts` | SEC-03/04/05 (all failed before) | pass | — | Verified |
| T-SEC-01 | P1 | Secure cookie on HTTPS demo | `common/auth.ts`, `auth.controller.ts`, `registration.controller.ts` | SEC-01 unit cases | pass | not observed on the live site | Verified (locally) |
| T-SEC-02 | P1 | Bound integrity-event detail, rate-limit events | `delivery.controller.ts` | SEC-02 (failed before: 5 000-char detail accepted) | pass | — | Verified |
| T-SEC-08 | P1 | Client IP from forgeable `X-Forwarded-For` | `config.ts` (`TRUST_PROXY` hop count, function form), `bootstrap.ts` | SEC-08 test: `true` → forged address, `1` → address the proxy saw | pass | live value must be set to Hostinger's hop count | Implemented; activation blocked on measuring the hop count |
| T-DI-01 | P1 | Tests for untested failure scenarios #7, #10, #13, #16/#17 | `test/failure-scenarios.test.ts` | 4 tests | pass (no defect found) | — | Verified |
| T-QA-01 | P1 | Port the fault-injection suite to MariaDB (DI-05) | `apps/api/test-fault/*`, `vitest.fault.config.ts`, `scripts/db-backup.mjs` (restore server: `--no-defaults`, own PID file, root-safe) | `npm run test:fault`: **17 passed, 1 skipped** (opt-in benchmark) — API SIGKILL ×2, kill inside a write, restart, lost acks, database crash + InnoDB recovery, Redis loss, clock forgery, reconciler failover, backup during writes + isolated restore | pass | not in CI (needs mariadbd on the runner; `.github/workflows/ci.yml` is a shared file) | Verified |
| T-PERF-01 | P1 | Port the load test to MariaDB and measure | `tests/load/exam-load.mjs` | runs below | pass (integrity) | not measured on Hostinger | Verified (local measurement) |
| T-PERF-02 | P1 | Start-burst capacity of one process | `delivery.service.ts` (per-process paper cache; no answer read-back for a new attempt) | §2b: realistic pace 1 000/3 000/5 000 candidates fine; burst of 3 000 starts in 6 s: 191 → 209 starts/s, p50 9.0 → 7.1 s | partial | a synchronized start of thousands within seconds queues for ~10 s on one process; mitigations are deployment/policy choices (§2b) | Implemented (partial gain), limit documented |
| T-A11Y-00 | P1 | Make the axe scans run (missing dependency) | `package.json`, `package-lock.json` (+2 entries) | 4 scans now run and pass | pass | — | Verified |
| T-A11Y-01 | P1 | Label-in-Name failure on exam palette | `exam/[examId]/palette.tsx`, `page.tsx` | axe `label-content-name-mismatch` → 0; 33 exam-player e2e pass | pass | — | Verified |
| T-A11Y-02 | P2 | Scan critical journeys | `tests/e2e/a11y-critical.spec.ts`, `global-setup.ts` (9 students/campus) | 11 more states, 0 serious/critical | pass | automated scans only | Verified |
| T-UX-A12 | P1 | Confirm deactivate / reset password | `(app)/users/page.tsx` | `users-confirm.spec.ts` | pass | — | Verified |
| T-UX-A11 | P1 | Enrolment term chosen from terms in use (data integrity) | `org.service/controller` (`GET /courses/:id/terms`), `enrolment/page.tsx` | `course-terms.test.ts`, `enrolment.spec.ts` | pass | default course still first in list | Verified |
| T-UX-A06/A08/A10 | P2 | Explained buttons (sign-in, change password); monitor 'Not started' once + quiet incident control; plain-language audit filters | `login`, `profile`, `monitor/[examId]`, `audit` pages | `explained-buttons.spec.ts`, `staff/exam-control/responsive/a11y-critical` specs, `list-state-and-paper.spec.ts` | pass | — | Verified |
| T-A11Y-04 | P2 | axe incl. target-size on question bank, exams, audit (A-07) | `tests/e2e/a11y-lists.spec.ts` | 3 scans, 0 serious/critical | pass | not hand-measured | Verified (automated) |
| T-UX-REST | P2 | Remaining UI findings A-03, A-04, A-05, A-09, A-13…A-18 | `profile`, `exams`, `exams/[id]`, `questions`, `layout.tsx`, `globals.css` | `ui-audit-batch3.spec.ts` (5 tests: all failed on the old UI, pass now); full Playwright 135 passed before adding it | A-03, A-09, A-14, A-15, A-17, A-04 (3 tables), A-05 (staff dashboards, `dashboard-attention.spec.ts`: fails on old UI) done | A-13, A-16, A-18 open | In progress |
| T-A11Y-03 | P1 | Manual screen-reader pass of the exam journey | — | — | — | — | Not started |
| T-OPS-01 | P1 | Production configuration: SMTP, MFA, portal enforcement, `NODE_ENV=production` | — | — | — | demo posture | Blocked — Hostinger access/approval |
| T-OPS-02 | P1 | Backup restore drill on Hostinger MariaDB | — | — | — | — | Blocked — database host access |
| T-DOC-01 | — | Audit documents (this folder) | `docs/audits/*` | — | — | — | Implemented |
| T-AI-DOCS | P3 | AI assessment, governance, status (`docs/ai/`) | 3 documents | — | — | — | Implemented |
| T-AI-F2a | P3 | Possible-duplicate questions (deterministic similarity) | `shared/similarity.ts`, `questions.service`, `GET /questions/duplicates`, question bank dialog | unit 4, `question-duplicates.test.ts`, `question-duplicates.spec.ts` (+axe) | pass | — | Verified |
| T-AI-F2b | P3 | Item-writing advice (7 deterministic rules) in editor and review view | `shared/item-writing.ts`, questions page | unit 5, `item-writing.spec.ts` (+axe); 4/127 seeded questions flagged | pass | rules are heuristics | Verified |
| T-AI-LLM | P3 | LLM features (drafting, LLM review, Bloom) | — | — | — | — | Blocked — owner approval, provider, credentials, data-processing agreement |
| T-PH12 | P1 | Hostinger deployment audit, readiness checklist, rollback docs | `docs/deployment/HOSTINGER_DEPLOYMENT_AUDIT.md`, `PRODUCTION_READINESS_CHECKLIST.md`, `ROLLBACK_AND_RECOVERY.md` | — | — | rollback not rehearsed | Implemented |
| T-PSY | P2 | Deterministic item statistics (difficulty, discrimination, corrected item–rest r, KR-20, SEM) | `shared/psychometrics.ts`, `results.service.ts` (additive API fields), exam page | unit 7 (hand-checked), `item-statistics.test.ts` (independent recomputation, campus scope), `item-statistics.spec.ts` | pass | small samples flagged as unstable | Verified |
| T-SEB | P3 | Optional Safe Exam Browser Config-Key verification | — | — | — | — | Not started |

## 2. Load measurements (T-PERF-01) — local, NOT Hostinger
Machine: 4 vCPU / 15 GB, API (one Node process, `apps/api/dist/main.js`, no Redis) + MariaDB 10.11 + load generator on the same host.
Scenario: every candidate starts, answers 50 questions with ~`think` ms between answers (15 % change of mind → second revision), heartbeats, submits, re-submits (replay must return the same receipt).
`think` = 0.3–1 s per question is **30–60× faster than a real candidate**, so request rates are far above a real sitting of the same size.

| Candidates | think | Pool | req/s | start p50 / p95 | save p50 / p95 / p99 | submit p95 | Errors | Acknowledged answers | Lost / altered |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 0.3 s | 20 | 297 | 15 / 45 ms | 3.9 / 10.7 / 21.4 ms | 10.0 ms | 0 | 5 000 | **0** |
| 500 | 1 s | 20 | 437 | 11 / 23 ms | 4.0 / 14.5 / 26.5 ms | 19.3 ms | 0 | 25 000 | **0** |
| 1 000 | 1 s | 20 | 676 | 32 / 3 695 ms | 340 / 534 / 693 ms | 1 056 ms | 0 | 50 000 | **0** |
| 1 000 | 1 s | 40 | 719 | 36 / 2 968 ms | 242 / 395 / 478 ms | 864 ms | 0 | 50 000 | **0** |

Reading: integrity held at every level (no acknowledged answer lost, every acknowledged submit sealed, replays returned identical receipts).
Latency degrades between 500 and 1 000 *highly active* candidates while host CPU stays ≈50 % — the single API process is the limit, the pool size a minor factor.
3 000 and 5 000 were not run (the generator shares the same 4 vCPUs; results would measure the test machine). **No capacity claim for Hostinger follows from this.**
Command: `node tests/load/exam-load.mjs --candidates N --questions 50 --think 1000 --ramp 20 --concurrency 512` with the API started as `RUN_WORKERS=true node --env-file=.env apps/api/dist/main.js`.

## 2b. Realistic pace and start bursts (same machine, one API process, pool 20)
Realistic = ~20 s per question (still faster than most candidates), 10 questions, every candidate also heartbeats every 15 s and submits twice (replay).

| Scenario | Starts | start p50 / p95 | save p50 / p95 / p99 | Errors | Acknowledged | Lost / altered | Host CPU mean |
|---|---|---|---|---|---|---|---|
| 1 000 candidates, starts spread over 20 s | 1 000 | 9.9 / 13.3 ms | 3.7 / 6.5 / 9.7 ms | 0 | 10 000 | **0** | 9 % |
| 3 000 candidates, starts over 30 s | 3 000 | 8.3 / 13.1 ms | 3.5 / 7.8 / 13.6 ms | 0 | 30 000 | **0** | 19 % |
| 5 000 candidates, starts over 60 s | 5 000 | 9.1 / 19.8 ms | 4.0 / 14.9 / 28.6 ms | 0 | 50 000 | **0** | 27 % |
| 5 000 candidates, starts within **10 s** (500/s) | 5 000 | 10 791 / 14 852 ms | 8.3 / 268 / 1 814 ms | 0 | 15 000 | **0** | 38 % |
| start only, 3 000 within 6 s (before T-PERF-02) | 3 000 | 8 982 / 12 365 ms | — | 0 | — | — | — |
| same, pool 40 | 2 979 | 6 108 / 10 857 ms | — | **21 client connect timeouts** | — | — | — |
| same, after T-PERF-02 (pool 20) | 3 000 | 7 139 / 10 462 ms | — | 0 | — | — | — |

Reading: at a human pace the single process handled 5 000 concurrent candidates with ample headroom; the binding constraint is the **start burst**
— about 200 starts/s per process (CPU profile: ~31 % idle waiting on the database, ~35 % in the database client/driver). A synchronized start
of thousands therefore queues for several seconds. Options (owner decision): stagger starts per campus (INDIVIDUAL timing already gives each
candidate their own clock), open admission/lobby early so starts spread, add a small client-side jitter for SYNCHRONIZED starts (costs a few
seconds of a shared clock — a policy question), or run more API processes (not possible on the current plan, see `HOSTINGER_DEPLOYMENT_AUDIT.md` §3).
All on one 4-vCPU machine with the database and the load generator; Hostinger numbers will differ.

## 3. Quality gates — before and after (executed, same environment)

| Gate | Before (`d6f297f`) | After (this branch) |
|---|---|---|
| Lint / typecheck / build / migrate | pass | pass |
| Shared unit | 58/58 | **77/77** |
| API integration (`apps/api`, vitest) | 335/335 (30 files) | **352/352 (35 files)** |
| Browser (Playwright) | 118 passed, **4 skipped** | **135 passed, 0 skipped, 0 failed** |
| Fault suite (`npm run test:fault`) | cannot run (PostgreSQL harness) | **17 passed, 1 skipped** |
| Load test (MariaDB) | could not run (PostgreSQL script) | runs; see §2 |

Environment: disposable MariaDB 10.11 on 127.0.0.1:3307 (READ COMMITTED, max_connections 500), no Redis, Node from the repo toolchain.
CI (MariaDB 11.8) has not yet run on these commits at the time of writing.

## 4. Commits
`b6d1a7c` SEC-01 · `02bb6e2` SEC-02 · `a45a897` SEC-03/04/05 · `cf0d354` tests · `e6d7433` SEC-06 · `79ed96b` test · `feb0fe8` SEC-07 · `8c79c92` test ·
`bc5c0da` axe dependency · `24e102f` palette Label-in-Name · `68b7c14` critical a11y scans · `69bf7a7` A-12 confirmations · (this commit) load-test port + audit documents.
