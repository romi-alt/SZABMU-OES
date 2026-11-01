# 07 — Live examination engine

Frontend `apps/web/src/app/exam/[examId]/page.tsx` (239 lines) + `apps/web/src/exam-engine.ts`; backend `delivery.service.ts`. Evidence: Playwright exam specs (4/4 PASS TODAY on a disposable stack), `exam-engine.test.ts`, `submit-contention.test.ts`, fault suite (TODAY), screenshots at 390/1280 px.

## A. Navigation (VERIFIED_WORKING)

Rendered and exercised: Previous, Next, **Skip question**, Mark/Unmark for review, Clear response, Save & next, numbered palette with direct selection, status counters (Answered / Skipped / Unanswered / Not visited / Marked) acting as filters, current-question highlight, keyboard (A–E, ←/→). The full-sitting spec covers answer, skip, mark, clear, filter, navigate, offline recovery, reload, review, submit, receipt. State survives reload (state is server-side per attempt). Skip does not erase an existing answer (engine tests; `state` is a separate field from `selectedLabel`). Combined states ANSWERED+marked, SKIPPED+marked, UNANSWERED+marked are representable (`markedForReview` is independent of `state`).
Not verified: assistive-technology behaviour of the palette; the 390 px layout shows the palette **below the fold** (screenshot) — usable by scrolling, not at a glance.

## B. Answer persistence (VERIFIED_WORKING for correctness)

Path: option click → `PUT /attempts/:id/answers/:qid` (`exam.sit`, session) → attempt/ownership/`activeClientId` check → one CTE that checks status, deadline (DB clock) and revision, upserts `attempt_answers`, appends `answer_events` → 200 only after commit → UI shows "✓ Saved". Verified TODAY:

| Property | Evidence |
|---|---|
| Real rows in PostgreSQL; no optimistic "saved" | engine tests read back rows; load integrity check (HISTORICAL 250 k) |
| Duplicate request protection / out-of-order revision | engine tests (stale revision → 409, same revision same payload → idempotent) |
| Multi-tab conflict | Playwright "second window takes over; first stops saving" PASS |
| Offline → retry | Playwright offline/online step PASS; backoff + crash buffer in `exam-engine.ts` |
| Redis failure | fault suite: outage and flush; saves and login keep working (circuit breaker); PASS TODAY |
| DB crash (`pg_ctl -m immediate`) | fault suite: no acknowledged answer lost, API recovers without restart, retries converge; PASS TODAY (note: the run exits 1 due to a harness pool error, see `14`) |
| API restart (SIGKILL) / lost responses after commit (TCP drop proxy) / two API processes | fault suite PASS TODAY |

## C. Timer (VERIFIED_WORKING)

Deadline computed server-side at start (`computeDeadline`, DB clock), returned with `serverNow`; client countdown is derived from server time offsets. Playwright: device clock +6 h changes neither deadline nor countdown; when the deadline passes with the page open it settles into an auto-submitted receipt with the saved answer. Per-candidate extension (`extend`) updates `deadlineAt`/`extraTimeMin` atomically and is audited, and reaches the client on the next heartbeat (SOURCE; extension → client display not browser-tested). **Exam-wide extension and suspension do not exist** (`08`). Saves after `deadlineAt + grace` are refused by the SQL predicate (`delivery.service.ts:171`).

## D. Final submission (VERIFIED_WORKING)

Explicit confirmation dialog; `POST /attempts/:id/submit` with `submitKey`; `FOR UPDATE` lock; answers re-read after the lock; sorted-by-question digest; HMAC receipt `RC-…`; status/event write in one statement; replay of a sealed attempt returns the identical receipt (without a transaction); grade enqueue time-boxed. Regression: 14×500 under a 3-connection pool before commit `47997bc`, 0 after (`submit-contention.test.ts` PASS TODAY). **The fix has not been re-measured under the 5,000-candidate load** — the earlier 63 submit 500s occurred in an unrelated crashed run (R2).

## Race conditions examined

| Race | Outcome |
|---|---|
| Save vs submit | `KEY SHARE` vs `UPDATE` lock; submit sees all committed saves; post-seal saves refused (409) |
| Double submit | idempotent via `submitKey` + replay path |
| Double start / two devices | unique constraint; winner resumed; `activeClientId` claim; loser stops |
| Save vs auto-submit by sweeper | same `finalize()` path/lock |
| Sweeper unavailable | **saves correct, state transitions stall** (`D-02`) — untested |
| Extension vs sweeper | `extend` and tick both predicate on `status='IN_PROGRESS'`; extension that lands after tick selects but before finalise is not locked against `finalize` — tick uses `deadlineAt + 5 s < clock_timestamp()` evaluated at select; a late extension could be applied to an attempt already chosen for finalisation (SOURCE, not reproduced; low probability, low impact because finalise re-reads under lock). |

## Admission (eligibility)

Start-time local re-validation of the roster/enrolment, decision frozen into `attempts.admission`, audited CCE/Super-Admin overrides; 15 tests PASS. A/B (EARLIER-TODAY, N=2000 start-only, 3 alternating rounds): admission on → start p50 **43 ms**, p95 **618 ms** (range 456–625); stubbed → p50 **23 ms**, p95 **388 ms** (range 359–419). Ranges do not overlap, so the admission lookup costs roughly +20 ms p50 / +230 ms p95 at this load; it does **not** explain the 724 ms → p50 at 2,000 in the earlier full run (full-run start was 723 ms p50 / 4.2 s p95 with concurrent saves; start-only is ≤ 0.1 s p50), which therefore reflects contention with the save/heartbeat mix and box saturation, not the admission query. Not isolated further.
