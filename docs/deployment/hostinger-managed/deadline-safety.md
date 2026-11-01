# Deadline safety

Question: can a student gain time, lose an acknowledged answer, or be scored twice because a worker, cron job or Redis is late or down?
Answer, from the code (`[CODE]`; **not run in this session**):

| Guarantee | Mechanism | Where |
|---|---|---|
| The clock is the **database's**, not the web server's or the browser's | save SQL tests `"deadlineAt" + make_interval(secs => SAVE_GRACE_SECONDS) > clock_timestamp()` | `delivery.service.ts` save (≈ line 197–215) |
| Late answer changes are refused | the same predicate is part of the `INSERT … ON CONFLICT … DO UPDATE … WHERE attempt_answers.revision < EXCLUDED.revision`; no row is written once the deadline + 5 s grace has passed | same |
| Retries cannot corrupt or reorder | revision check: identical revision = no-op; stale revision = rejected, newer data never overwritten | same |
| Acknowledged = durable | the response is sent after the statement commits (`synchronous_commit=on` is a provider requirement) | engine design, doc `database-connectivity.md` |
| Sealed answers are immutable | trigger `attempt_answers_lock` raises "attempt … is finalised; answers are immutable" on any change | migration `20261031195018_integrity_constraints` |
| An expired attempt is sealed even if no worker runs | `start` and `heartbeat` call `finalize(AUTO)` when `now > deadline + grace`; `submit` finalizes | `delivery.service.ts` (heartbeat ≈ line 223) |
| Finalize is idempotent and recoverable | row lock, `submitKey`; a replay returns the same receipt (`replayed: true`); `ALREADY_SUBMITTED` carries the receipt code | `delivery.service.ts` 112, 298–321 |
| One attempt and one result per student per exam | `@@unique([examId, studentId])` on attempts and results; grading is `result.upsert` on that key, so a second grading **overwrites the same row** (never a second row) | `schema.prisma` 558/756, `results.service.ts` 36–42 |
| State moves forward without Redis | reconciler runs in PostgreSQL; the grade queue is an accelerator and `gradeBackstop` grades any sealed attempt with no result | `lifecycle.service.ts` |

## Where the reliance on a runner remains
An attempt whose candidate never calls the API again (closed laptop) stays `IN_PROGRESS` in the database until **something** runs `finalize`: the worker (≤ ~10 s), the cron backstop (≤ ~1 min plus cron jitter), or staff. Its answers are safe and further writes are refused throughout; what is delayed is the **receipt state, grading and result release**, never extra time or lost data. This is why the cron job is a backstop and the worker a requirement for unattended exams (`cron-limitations.md`).

## Timing facts that matter on this platform
- 120 s request limit: saves are single short statements, unaffected; submit/finalize of one attempt is a short transaction.
- Time extensions, suspension and synchronized starts are **database state** (`deadlineAt`, control commands, `computeSyncDeadline`), applied the same way for every API process.
- Client countdown uses the server offset; a wrong device clock changes nothing (e2e test `exam.spec.ts` "manipulated device clock").

## Tests that must pass on the hosted topology (none run here)
Doc 10, tests C-1…C-5 and the 14-step scenario in `reliability-test-results.md`.
