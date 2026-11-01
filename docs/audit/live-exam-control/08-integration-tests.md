# 08 — Integration tests

Real PostgreSQL 16 + Redis; exams are built through the real services (create → paper → four-eyes approval → schedule) and driven only through HTTP; the database is read to prove what happened. Fault tests run on disposable infrastructure created by the harness (never the shared dev DB/Redis).

| Suite | Tests | Where it runs |
|---|---|---|
| `test/exam-control.test.ts` | 36 | test database (Redis DB 1) |
| `test/exam-control-stream.test.ts` (SSE over a real socket) | 6 | test database |
| `test-fault/control.test.ts` | 3 | disposable PostgreSQL + Redis + real API processes |
| `packages/shared` `computeSyncDeadline` | 2 | unit |

Final full-suite counts are in `09-browser-tests.md` / `docs/implementation-status.md`.

## Your 30 scenarios → evidence

| # | Scenario | Test |
|---|---|---|
| 1 | Controller opens admission | `1–5 admission › nobody can start before admission is opened…` (state, event, audit written together) + idempotent re-open |
| 2 | Eligible student starts | `1/2. an eligible student enters and gets the individual deadline` |
| 3 | Ineligible student rejected | same test: revoked candidate rejected, off-roster student 403, no attempt rows created |
| 4 | Controller closes admission | `4/5. closing admission blocks new entrants…` |
| 5 | Existing active attempt remains valid | same test: resume + save after close; re-open works |
| 6 | Controller starts synchronized exam | `SYNCHRONIZED: candidates wait in the lobby…` (WAITING_FOR_START, no attempt, then START) |
| 7 | Candidate answers | answers saved in every control scenario (`answer()` helper → 200) |
| 8 | Controller suspends | `8–10 … suspend (whole exam)` |
| 9 | Student receives suspension state | heartbeat + `start` return `suspended:true, examStatus:'SUSPENDED'`; SSE `EXAM_SUSPENDED` (stream suite) |
| 10 | Backend enforces suspension policy | save → 409 `EXAM_SUSPENDED` (refused write did not land), manual submit refused, new starts refused, sealed attempt not suspended; FREEZE vs CONTINUES; CAMPUS and CANDIDATES scopes |
| 11 | Controller resumes | `11/12. resume (FREEZE_CLOCK)…` (deadline +paused seconds, window end moved) |
| 12 | Answers intact | confirmed answer revision 1 preserved; saving works again; sealed attempt byte-identical |
| 13 | Extends selected candidates | `13/14. selected candidates get exactly +N minutes` |
| 14 | Correct deadline | `deadline == previous + N·60 000 ms`; others unchanged; CAMPUS scope; EXAM scope moves window end |
| 15 | Duplicate extension not applied twice | same key → `replayed:true`, deadline +N once, one extension row, one attempt event; key reuse across commands → `KEY_REUSED` |
| 16 | Unauthorized campus staff cannot extend | `16/30 authorization…`: 6 roles × 11 endpoints → 403, anonymous 401, state/events unchanged |
| 17 | Two controllers conflict | `17/18 conflicting controllers` (SUSPEND ∥ CLOSE ×3 rounds; stale `expectedVersion` → `STALE_STATE`) |
| 18 | One wins safely | exactly one `changed:true`, one 409; version +1; one event; one audit row |
| 19 | Redis fails | fault test 1 |
| 20 | Answer saving continues | fault test 1: saves 200 with Redis down |
| 21 | Lifecycle continues / recoverably resumes | fault test 1 (seal with Redis down) + 2 (restart) + 3 (failover); in-process lease/backlog/poison tests |
| 22 | API process restarts | fault test 2 (SIGKILL with backlog; sealed exactly once after restart) |
| 23 | Monitoring reconnects | stream suite (cursor replay) + fault test 2 (reconnect after crash) |
| 24 | Missed event state reconciles | replay returns exactly the missed events, once, in order; `/me/exams/:id/state` + heartbeat are the authoritative fallback |
| 25 | Attempt reaches deadline | `26. an attempt past its deadline…` (API refuses with `TIME_EXPIRED` before any worker acts) |
| 26 | Auto-submit exactly once | three concurrent reconcile passes → 1 seal, 1 `AUTO_SUBMITTED` event, stable receipt; 4 passes × 9-attempt backlog → 9 seals, 9 distinct receipts |
| 27 | Scoring only when valid | `27/28`: initiate-scoring refused before CLOSED and while attempts are in progress; MANUAL exams do not score by themselves; then SCORING → RESULT_PENDING, absentees recorded |
| 28 | Closed exam stays finalized | save → `ATTEMPT_CLOSED`, new start refused, suspend refused after close |
| 29 | Cross-campus monitoring denied | `29 monitoring…`: campus A snapshot/candidates/compat monitor contain no campus B; `institutionId=<B>` empty; unassigned invigilator 404; student/lecturer 403; SSE scoping over sockets |
| 30 | Audit matches transitions | `19/22 events, outbox and audit`: 7 commands → 7 events (versions v0+1…v0+7) → 7 audit rows → `stateVersion = v0+7`; no-ops write nothing; refused commands leave nothing; hash chain verifies; `exam_events` DELETE/UPDATE-of-content rejected by trigger |

## Bugs the tests found (all fixed)

1. Raw outbox insert left `eventId` NULL (Prisma-only default) — every reconciler transition failed until fixed.
2. `ADMISSION_CLOSED` was reported as `NOT_AVAILABLE` after closing admission.
3. Eligibility override refused in `ADMISSION_OPEN`/`SUSPENDED`; cancel allowed in new live states; the student exam list and invigilator duties ignored the new states.
4. The key-confidentiality sweep hung on the never-ending SSE routes (now excluded by name, covered by its own test).
5. In the browser: my synchronized-exam drill left an admission-open exam that broke other specs (clean-up added).

## Not tested

Behaviour at 10,000–20,000 candidates; PostgreSQL failover; multi-host clock skew; SSE behind a real reverse proxy/CDN (buffering); Firefox/Safari `EventSource`.
