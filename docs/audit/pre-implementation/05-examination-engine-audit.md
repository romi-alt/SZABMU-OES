# 05 — Examination Engine Audit

Source: `apps/api/src/modules/delivery/delivery.service.ts`, `apps/web/src/exam-engine.ts`, `packages/shared/src/exam-rules.ts`, DB migration `integrity_constraints`.

## Path trace
select option → page handler → `ExamEngine.answer()` bumps per-question `revision` → save queue (`PUT /attempts/:id/answers/:qid` with `{clientId, revision, selectedLabel, state, markedForReview, visited}`) → zod → `saveAnswer` single SQL statement (`ON CONFLICT … DO UPDATE … WHERE revision < EXCLUDED.revision` + `answer_events` insert, `FOR KEY SHARE` on the attempt, DB-clock deadline + 5 s grace, `activeClientId` check) → commit → `saved:true` → UI shows "Saved" only on that ack.

## Question-by-question (spec items 1–16)
| # | Item | Finding | Status |
|---|---|---|---|
| 1–2 | Start & eligibility | roster row required; exam SCHEDULED/LIVE, paper APPROVED, inside window (DB clock); eligibility fixed when the roster is built, **not re-checked at start** | V (partial: stale eligibility possible if enrolment changes after roster build) |
| 3–4 | Paper load / order | frozen snapshot from `exam_questions`, cached in Redis 1 h (key never in payload); seeded shuffle persisted in `attempts.questionOrder` | V |
| 5–9 | Answer / skip / flag / sidebar / palette | Previous, Next, Skip, Mark/Unmark, Clear, Save&Next, direct jump, filters, counters | V (Playwright, last session) |
| 11–12 | Store / update | PG row + append-only journal | V (API tests, load verifier) |
| 13 | Timer | `deadlineAt` computed server-side; client uses server-offset only to render | V |
| 14 | Resume | `start` is idempotent and returns saved answers + revisions; engine reconciles via `GET …/sheet` | V |
| 15–16 | Submit / finalise | row lock `FOR UPDATE`, answer digest, HMAC receipt, idempotent replay returns same receipt; sweeper auto-submits expired | V |

## Concurrency / integrity questions
| Question | Answer | Evidence |
|---|---|---|
| Truly stored in PG? | Yes; Redis never holds answers | SQL; load verifier checked 100,000 acked answers in PG |
| Older request overwriting newer? | No: `WHERE revision < EXCLUDED.revision`; equal revision = idempotent no-op | exam-engine.test |
| Racing / duplicate requests safe? | Yes, tested with parallel same/out-of-order revisions | exam-engine.test |
| Two tabs? | Second `start` claims `activeClientId`, bumps `clientEpoch`; old tab gets 409 `SESSION_SUPERSEDED` | exam-engine.test, e2e |
| Refresh keeps answers? | Yes (server source of truth) | e2e |
| Network loss loses answers? | Client queue retries with backoff; localStorage is a buffer only; unacked answers re-sent. Cannot claim zero loss if the browser storage is cleared before reconnect | NOT_VERIFIED at browser level beyond e2e offline test |
| **API / PG restart loses acked answers?** | By design no (ack follows commit). **No test kills the API or PG mid-run.** | **NOT_VERIFIED — HIGH priority gap** |
| Submit idempotent / immutable after? | Yes; DB trigger locks `attempt_answers` for non-IN_PROGRESS attempts; journal append-only | trigger test, exam-engine.test |
| Client clock manipulation? | Not trusted for any decision: no client time is sent to or read by the API; deadline tests move `deadlineAt` in the DB. **No test explicitly simulates a skewed/manipulated browser clock** (NOT_VERIFIED by test; true by code reading) | code reading |
| Extensions | Per-candidate `extraTimeMin` and invigilator `extend` update `deadlineAt` (audited); **no exam-wide extension** | `invigilation.service.ts` |

## Residual risks
1. **Crash/restart durability untested** (above).
2. `answer_events` grows ~ (candidates × questions × revisions); no retention/partitioning.
3. Eligibility not re-evaluated at start (policy question — see roadmap P1-3).
4. Sweeper runs inside every API process with `RUN_WORKERS=true`; correctness under N processes relies on idempotent SQL predicates and BullMQ job ids — not load-tested with >1 process.
5. `saved` indicator correctness under partial failures (e.g., proxy returns 502 after commit) relies on client retry being idempotent — covered by dedupe tests but not by fault injection.
6. Heartbeat/Redis loss: monitor shows stale data; exam unaffected (V by design, not fault-tested).

**Classification:** engine functional and correct under the tested concurrency model; data-loss resistance under infrastructure faults is NOT VERIFIED; scale beyond 2,000 NOT VERIFIED.
