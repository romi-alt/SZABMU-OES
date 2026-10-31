# 08 — Real-time monitoring and examination control

## Monitoring: what exists

`GET /invigilation/exams/:id/monitor` (`invigilation.service.ts:39-60`), page `monitor/[examId]/page.tsx` which re-fetches every **5 s** (`setInterval(st.reload, 5000)`, line 12). There is **no** SSE, WebSocket, outbox or event stream (grep over `apps/*/src`: none). It is a polled snapshot.

| Question | Answer | Evidence |
|---|---|---|
| Data from real student records? | Yes: `exam_candidates`, `attempts`, `attempt_answers` counts, heartbeats from Redis | SOURCE; e2e: invigilator sees live candidate "In progress" (spec failed *before* this on MFA pollution; the API probe returned 200 with own-campus rows) |
| Active/started/answered counts, last save, submitted, disconnected | Per row: status, connection (`ONLINE/DISCONNECTED/FINISHED/NOT_STARTED`), answered count; summary counters | SOURCE |
| Auto-updates | Only by polling | SOURCE |
| Events missed? | No events exist; a poll always reads current DB state, so nothing is "missed", but latency is up to 5 s + query time | SOURCE |
| Redis down | Heartbeat read is in a `try/catch`; every in-progress candidate then shows **DISCONNECTED** (fails safe but noisy) | SOURCE (`:48`) |
| API restart | Stateless; next poll works | SOURCE |
| Multiple API instances | Consistent: state is in PostgreSQL/Redis, not process memory | SOURCE; fault suite ran 2–3 APIs for saves |
| Campus sees other campus data? | **No**: invigilator.a/admin.a monitors returned only `DMC-A` rows; admin.b only `DMC-B`; invigilator.a force-submit of a campus-B attempt → 404, admin.a → 403 | TODAY live probe |
| Load impact on saving | **Unmeasured.** Each poll runs `findMany` over all candidates and attempts of the exam plus `GROUP BY` over all `attempt_answers` of the exam *regardless of campus* (`:44-46`), unbounded. At 20,000 candidates every viewer's poll is O(candidates × questions). | SOURCE; HISTORICAL note in status doc |

Incidents: report/list/note/resolve exist with campus scoping (`invigilation.service.ts:90-130`); an invigilator only sees incidents they reported. High-severity incidents notify the CCE (link dead, see `04`).

## Examination control operations (Phase 8)

| Operation | Exists? | Auth | State machine | Audit | Frontend | Tests | Status |
|---|---|---|---|---|---|---|---|
| Create exam | yes `POST /exams` (`exam.schedule`) | ✓ | DRAFT | ✓ | ✓ | workflow ✓ | VERIFIED (API) |
| Paper build/submit/approve | yes (separation of duties) | ✓ | DRAFT→PAPER_PENDING→APPROVED | ✓ | ✓ | workflow ✓ | VERIFIED (API) |
| Schedule | yes `POST /exams/:id/schedule` | ✓ | APPROVED→SCHEDULED | ✓ | ✓ | workflow ✓ | VERIFIED (API) |
| Open admission / start exam | **no API** — `SCHEDULED→LIVE` by tick when `opensAt` passes | n/a | time-driven | no | – | – | NOT_IMPLEMENTED (as an operation) |
| Close admission / close exam | **no API** — `→CLOSED` by tick when `closesAt` passed and none in progress | n/a | time-driven | no | – | – | NOT_IMPLEMENTED |
| **Suspend / resume** | **no** (404 TODAY) | – | no state exists in `ExamStatus` | – | – | – | NOT_IMPLEMENTED |
| Extend one candidate +1–60 min | yes (`invigilation.intervene`; reason; audited; attempt event) | ✓ | IN_PROGRESS only | ✓ | button `+ Time` | API tests; UI spec not reached | PARTIALLY_VERIFIED |
| **Extend exam / selected candidates in bulk** | **no** | – | – | – | – | – | NOT_IMPLEMENTED (P-23) |
| Force-submit | yes (reason ≥5 chars; audited; candidate notified) | ✓ | any non-sealed attempt | ✓ | ✓ | API ✓ | VERIFIED (API) |
| Process incidents | yes | ✓ | OPEN→INVESTIGATING→RESOLVED/DISMISSED | ✓ | ✓ | ✓ | VERIFIED |
| Cancel exam | yes (before LIVE) | ✓ | guarded (`exams.service.ts:262`) | ✓ | ✓ | ✓ | VERIFIED (API) |
| Initiate result processing | **automatic** only (tick: closed + graded → RESULT_PENDING) | – | time/sweeper-driven | no | – | – | PARTIALLY (no manual trigger; no retry button) |
| Eligibility override (CCE/SA) | yes | ✓ | SCHEDULED/LIVE | ✓ append-only | ✓ | 15 ✓ | VERIFIED |

Consequence: if a hall loses power, a paper error is found, or a campus must be paused, staff cannot stop or extend an exam; they can only force-submit individuals or edit nothing. This is the single largest functional gap for supervised use.
