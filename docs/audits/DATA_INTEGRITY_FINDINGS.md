# Data-integrity findings — 2026-11 full-system audit

Environment for every result below: disposable MariaDB 10.11 (READ COMMITTED, as production), no Redis (coordination in the database, as on Hostinger),
commit range `d6f297f..HEAD` of `claude/oes-platform-foundation`. Production runs MariaDB **11.8**; the CI job `verify`/`node24` uses 11.8 and is the
authority for version-specific behaviour.

## 1. How the exam engine protects answers (verified in code and tests)

| Mechanism | Where | Evidence |
|---|---|---|
| Server/database clock only: start time, deadline, expiry and "saved at" all come from `NOW(3)` of the database | `delivery.service.ts` `start`, `writeAnswer`, `heartbeat`, `seal` | `exam-engine.test.ts` "rejects saves after the deadline+grace…", e2e `exam.spec.ts` "server clock rules" |
| Per-answer revision; only a strictly newer revision replaces the stored one; replay of the same revision is idempotent | `writeAnswer` (row lock `FOR UPDATE`) | "out-of-order concurrent writes converge on the highest revision (no lost update)", "is idempotent: replaying…" |
| "Saved" only after commit (answer row + `answer_events` journal in one transaction) | `writeAnswer` | e2e: "Saved" appears only after server acknowledgement |
| Save vs submit serialised: save takes a SHARE lock on the attempt row, seal takes FOR UPDATE | `writeAnswer`, `seal` | "a save racing a submit is either fully included in the receipt or rejected — never saved yet missing" |
| Seal exactly once; replays return the identical receipt; digest + HMAC receipt code | `seal` | "12 concurrent submits yield one receipt", `submit-contention.test.ts` |
| One active client per attempt (other tabs/devices become read-only) | `start` (`activeClientId`, `clientEpoch`) | "a second window claiming the attempt makes the first window read-only" |
| Submit refuses when the screen disagrees with the database | `seal` `ANSWERS_OUT_OF_SYNC` | engine test of the same name |
| Frozen paper: approval copies stem/options into `exam_questions.snapshot` and the key into `correctLabel` | `exams.service.ts` approve | new test #16/#17 |
| Database constraints: CHECK `deadlineAt > startedAt`, unique (exam, student) attempt/result, append-only triggers on journals and audit | `prisma/migrations/20261104000000_mysql_baseline` | the CHECK fired during this audit when a test moved only the deadline (see #7) |

## 2. Findings

No defect was found in answer persistence, sealing, timing or grading. All 20 required scenarios below are covered by tests that were **executed** in this audit.

| ID | Severity | Finding | Status |
|---|---|---|---|
| DI-01 | Low | Four high-stakes scenarios (#7, #10, #13, #16/#17) had no direct test | Fixed: `apps/api/test/failure-scenarios.test.ts` (4 tests, all pass) |
| DI-02 | Info | Item analysis and grading read `correctLabel` + key actions; there is no separate scoring version number — the immutable snapshot plus the append-only `key_actions` list is the version history | Documented |
| DI-03 | Medium (operational) | Backups/restores of the Hostinger MariaDB are not proven by a restore drill in this audit (a backup tool with restore verification exists: `scripts/db-backup.mjs`, `npm run backup:verify`) | Open — needs access to the production database host |
| DI-04 | Info | Local tests ran on MariaDB 10.11, production is 11.8 | CI on 11.8 remains the authority |
| DI-05 | **High (assurance gap)** | The durability fault-injection suite `apps/api/test-fault/` (process kills, dropped connections, pool exhaustion, backup/restore) was not ported in the PostgreSQL→MariaDB move: its harness starts a disposable PostgreSQL and uses the `pg` driver, so `npm run test:fault` fails at `prisma migrate deploy` (P1013). CI does not run it, so this was invisible. The strongest evidence that acknowledged answers survive crashes therefore exists only for the old database. | **Fixed**: harness ported; `npm run test:fault` 17 passed, 1 skipped (T-QA-01) |

## 3. The 20 failure scenarios (Phase 10)

"Executed" = run in this audit (API suite 335 + 4 + 9 new tests, Playwright 118 + 3 new). Exact commands in `IMPLEMENTATION_TRACKER.md`.

| # | Scenario | Expected | Test (executed) | Result |
|---|---|---|---|---|
| 1 | Refresh during an active exam | resumes, same order, saved answers | `exam-engine` "persists, then returns the saved answer on resume"; e2e `exam.spec` reload | Pass |
| 2 | Internet lost for minutes | answers queued, "not yet confirmed" shown, resent on reconnect | e2e `exam.spec` "offline recovery"; `exam-player-safety.spec` unsynced state | Pass |
| 3 | Reconnect before expiry | queued answers saved | same as 2 | Pass |
| 4 | Reconnect after expiry | late saves refused; attempt auto-submitted with answers saved in time | `exam-engine` "rejects saves after the deadline+grace and auto-submits" | Pass |
| 5 | Two saves in reverse order | highest revision wins, no lost update | `exam-engine` out-of-order test | Pass |
| 6 | Two simultaneous final submissions | one seal, identical receipts | `exam-engine` 12 concurrent submits | Pass |
| 7 | Submit after expiration | sealed as AUTO_SUBMITTED with only in-time answers | **new** `failure-scenarios` #7 | Pass |
| 8 | Extension during an active attempt | exactly +N for the selected, idempotent, never both sealed and extended | `exam-control` 13/14/15 and the race test | Pass |
| 9 | Suspension while answering | saves/submits/starts refused by the database; answers intact; resume shifts deadlines (FREEZE_CLOCK) | `exam-control` 8–12 | Pass |
| 10 | Access to another student's attempt | 404 on every attempt endpoint; nothing changes | **new** `failure-scenarios` #10 | Pass |
| 11 | Teacher fetches results by direct API | refused | `teachers.test` role matrix | Pass |
| 12 | Campus admin cross-campus access | refused/filtered, never widened | `campus-isolation` 1–10 | Pass |
| 13 | Session expires during an exam | saves 401; after sign-in the attempt resumes with every confirmed answer | **new** `failure-scenarios` #13 | Pass |
| 14 | Transaction fails during a save | not "saved"; retried; no partial row | fault suite A2 "crash INSIDE a write" (connection killed mid-transaction; API killed mid-statement) on MariaDB | Pass |
| 15 | Backend restarts during a session | attempts durable; backlog reconciled once | fault suite A/B (real SIGKILL of the API process) and control "API process killed and restarted with a backlog" | Pass |
| 16 | Result recalculated after a question-bank revision | unchanged | **new** `failure-scenarios` #16/#17 | Pass |
| 17 | Paper changed after candidates started | delivered paper unchanged (snapshot) | **new** `failure-scenarios` #16/#17 | Pass |
| 18 | Multiple concurrent sessions for one attempt | one active client; others read-only | `exam-engine` second window test | Pass |
| 19 | Monitoring receives stale state | snapshot equals independent counts; clients fall back to authoritative reads | `exam-control` "every number is the database's", `exam-control-stream` "/me/exams/:id/state is the authoritative fallback" | Pass |
| 20 | Thousands submit near the deadline | every attempt sealed once, no 500 | `submit-contention.test` (concurrent submissions with a 3-connection pool) — scale in this run: the test's configured candidate count, not thousands; the earlier 2 000-candidate load run is from a previous session on PostgreSQL | Pass at test scale; plus the ported load test on MariaDB: 1 000 candidates × 50 questions, 2 000 submits (incl. replays), 0 lost/altered (local, not Hostinger) |

## 4. What still needs measurement
- #14: port and run the fault suite (DI-05); a MariaDB-specific load test (`npm run test:load`) at 100/500/1 000 candidates — see `IMPLEMENTATION_TRACKER.md` T-PERF-01.
- Restore drill of a real backup (DI-03).
