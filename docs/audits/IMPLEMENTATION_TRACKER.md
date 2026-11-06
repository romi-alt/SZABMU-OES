# Implementation tracker — 2026-11 transformation programme

Status labels (truthful only): **Not started · In progress · Implemented, unverified · Verified · Blocked · Deferred.**
"Verified" means a test that failed on the old code (or an executed measurement) now passes; the evidence column names it.
Branch `claude/oes-platform-foundation`, from commit `d6f297f`. **Nothing has been merged to `main` or deployed** (merging deploys; needs approval).

## 1. Tasks

| ID | Pri | Description | Files changed | Tests / evidence | Result | Remaining risk | Status |
|---|---|---|---|---|---|---|---|
| T-SEC-07 | P0 | TOTP brute-force via parallel requests | `modules/auth/mfa.service.ts`, `auth.service.ts` | `audit-hardening.test.ts` SEC-07 (failed before: 0/40 refused); `mfa.test.ts` | pass | none known | Verified |
| T-SEC-06 | P0 | Sign-up code brute-force via parallel requests (student + teacher) | `registration.service.ts`, `teacher-registration.service.ts` | SEC-06 (failed before: correct code accepted after 30 guesses) | pass | teacher path covered by the same code; its own regression test is not written | Verified (student) / Implemented, unverified by a dedicated test (teacher) |
| T-SEC-03/04/05 | P0 | Reset-code guess race, per-address code limit, audit role | `auth.service.ts` | SEC-03/04/05 (all failed before) | pass | — | Verified |
| T-SEC-01 | P1 | Secure cookie on HTTPS demo | `common/auth.ts`, `auth.controller.ts`, `registration.controller.ts` | SEC-01 unit cases | pass | not observed on the live site | Verified (locally) |
| T-SEC-02 | P1 | Bound integrity-event detail, rate-limit events | `delivery.controller.ts` | SEC-02 (failed before: 5 000-char detail accepted) | pass | — | Verified |
| T-SEC-08 | P1 | Client IP from forgeable `X-Forwarded-For` | — | analysis only | — | per-IP limits and audit IP spoofable (per-account limits mitigate) | Blocked — needs the real hop count on Hostinger (approval for a diagnostic) |
| T-DI-01 | P1 | Tests for untested failure scenarios #7, #10, #13, #16/#17 | `test/failure-scenarios.test.ts` | 4 tests | pass (no defect found) | — | Verified |
| T-QA-01 | P1 | Port the fault-injection suite to MariaDB (DI-05) | — | `npm run test:fault` fails at migrate (P1013) | — | crash-durability evidence only exists for PostgreSQL | Not started |
| T-PERF-01 | P1 | Port the load test to MariaDB and measure | `tests/load/exam-load.mjs` | runs below | pass (integrity) | not measured on Hostinger | Verified (local measurement) |
| T-PERF-02 | P1 | Reduce start-burst latency / single-process limit | — | 1 000 candidates: start p95 3.0–3.7 s, save p50 242–340 ms at CPU ≈50 % | — | exam start bursts on one Node process | Not started (needs design: cache paper earlier, lighter start path, or more processes if the plan allows) |
| T-A11Y-00 | P1 | Make the axe scans run (missing dependency) | `package.json`, `package-lock.json` (+2 entries) | 4 scans now run and pass | pass | — | Verified |
| T-A11Y-01 | P1 | Label-in-Name failure on exam palette | `exam/[examId]/palette.tsx`, `page.tsx` | axe `label-content-name-mismatch` → 0; 33 exam-player e2e pass | pass | — | Verified |
| T-A11Y-02 | P2 | Scan critical journeys | `tests/e2e/a11y-critical.spec.ts`, `global-setup.ts` (9 students/campus) | 11 more states, 0 serious/critical | pass | automated scans only | Verified |
| T-UX-A12 | P1 | Confirm deactivate / reset password | `(app)/users/page.tsx` | `users-confirm.spec.ts` | pass | — | Verified |
| T-UX-REST | P2 | UI findings A-03…A-11, A-13…A-18 | — | — | — | — | Not started |
| T-A11Y-03 | P1 | Manual screen-reader pass of the exam journey | — | — | — | — | Not started |
| T-OPS-01 | P1 | Production configuration: SMTP, MFA, portal enforcement, `NODE_ENV=production` | — | — | — | demo posture | Blocked — Hostinger access/approval |
| T-OPS-02 | P1 | Backup restore drill on Hostinger MariaDB | — | — | — | — | Blocked — database host access |
| T-DOC-01 | — | Audit documents (this folder) | `docs/audits/*` | — | — | — | Implemented |
| T-PH8 | P3 | AI features (Phase 8) | — | — | — | — | Not started (governance documents first; no external AI provider without approval) |
| T-PH12 | P1 | Hostinger deployment audit, readiness checklist, rollback docs | — | — | — | — | Not started |
| T-PSY | P2 | Deterministic item statistics (discrimination, point-biserial, KR-20) | — | — | — | — | Not started |
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

## 3. Quality gates — before and after (executed, same environment)

| Gate | Before (`d6f297f`) | After (this branch) |
|---|---|---|
| Lint / typecheck / build / migrate | pass | pass |
| Shared unit | 58/58 | 58/58 |
| API integration (`apps/api`, vitest) | 335/335 (30 files) | **348/348 (32 files)** |
| Browser (Playwright) | 118 passed, **4 skipped** | **126 passed, 0 skipped, 0 failed** |
| Fault suite (`npm run test:fault`) | cannot run (PostgreSQL harness) | cannot run (T-QA-01) |
| Load test (MariaDB) | could not run (PostgreSQL script) | runs; see §2 |

Environment: disposable MariaDB 10.11 on 127.0.0.1:3307 (READ COMMITTED, max_connections 500), no Redis, Node from the repo toolchain.
CI (MariaDB 11.8) has not yet run on these commits at the time of writing.

## 4. Commits
`b6d1a7c` SEC-01 · `02bb6e2` SEC-02 · `a45a897` SEC-03/04/05 · `cf0d354` tests · `e6d7433` SEC-06 · `79ed96b` test · `feb0fe8` SEC-07 · `8c79c92` test ·
`bc5c0da` axe dependency · `24e102f` palette Label-in-Name · `68b7c14` critical a11y scans · `69bf7a7` A-12 confirmations · (this commit) load-test port + audit documents.
