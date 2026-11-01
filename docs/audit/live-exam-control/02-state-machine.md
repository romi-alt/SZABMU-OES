# 02 — State machine

The persisted `Exam.status` is extended, not duplicated. Mapping to the brief's names:

| Brief | Persisted `ExamStatus` | Note |
|---|---|---|
| DRAFT, APPROVED, SCHEDULED | `DRAFT` (+ `PAPER_PENDING`), `APPROVED`, `SCHEDULED` | unchanged |
| ADMISSION_OPEN | `ADMISSION_OPEN` | **new** |
| IN_PROGRESS | `LIVE` | existing name kept |
| SUSPENDED | `SUSPENDED` | **new** (whole-exam suspension) |
| CLOSING | `CLOSING` | **new**: admission closed, attempts finishing |
| CLOSED | `CLOSED` | existing |
| SCORING | `SCORING` | **new** |
| RESULT_REVIEW | `RESULT_PENDING` | existing name kept |
| RESULT_PUBLISHED | `PUBLISHED` | existing |
| CANCELLED | `CANCELLED` | existing |

Partial suspensions (one campus, selected candidates) keep the exam `LIVE`; they live in `exam_suspensions` and on `attempts.suspendedAt`.

## Policy fields stored on the exam (not frontend flags)

| Column | Meaning |
|---|---|
| `timingPolicy` `INDIVIDUAL \| SYNCHRONIZED` | each candidate's clock vs one official clock |
| `controlMode` `AUTOMATIC \| MANUAL` | AUTOMATIC = legacy schedule-driven opening/closing; MANUAL = staff commands |
| `suspendTimePolicy` `FREEZE_CLOCK \| CLOCK_CONTINUES \| NULL` | **NULL = undecided**: suspension is refused until an approver (`exam.control.policy`) sets it; stamped with approver and time |
| `officialStartAt`, `admissionOpenedAt`, `admissionClosedAt`, `closedAt`, `forceCloseAt` | transition facts |
| `stateVersion` | bumped by every transition; stamps each event; optimistic check via `expectedVersion` |

## Transition table (generated from `TRANSITIONS`)

| Command | From | To | Preconditions | Deadlines | Candidates | Audit | Idempotent | Retry |
|---|---|---|---|---|---|---|---|---|
| OPEN_ADMISSION | SCHEDULED (or LIVE/SUSPENDED with admission closed) | ADMISSION_OPEN (or same) | paper approved, ≥1 question, ≥1 admitted candidate, window not over | none | eligible candidates may enter | `exam.control.open_admission` | already open → no change | safe |
| CLOSE_ADMISSION | ADMISSION_OPEN / LIVE / SUSPENDED | SCHEDULED (from ADMISSION_OPEN) or same | admission open | none | no NEW attempts; active ones keep all rights | `exam.control.close_admission` | already closed → no change | safe |
| START | SCHEDULED, ADMISSION_OPEN | LIVE | as OPEN; SYNCHRONIZED: start+duration ≤ window end or `extendWindow` | SYNCHRONIZED: official clock starts; INDIVIDUAL: none | lobby candidates may begin | `exam.control.start` | LIVE → no change; official start never moves | safe |
| SUSPEND | LIVE | SUSPENDED (EXAM scope) / same (CAMPUS, CANDIDATES) | policy approved, reason ≥ 10, confirm, valid scope | per policy | in-progress attempts get `suspendedAt`: saves/submits refused by SQL; new starts refused for the scope | `exam.control.suspend` | same open scope → no change | safe |
| RESUME | SUSPENDED / LIVE with open suspension | LIVE | an open suspension (named if ambiguous) | FREEZE: each deadline += its own paused time, window end += exam-wide pause; CONTINUES: unchanged | resume with answers intact; sealed attempts untouched; notified | `exam.control.resume` | already resumed → no change | safe |
| EXTEND | LIVE / SUSPENDED / CLOSING | same | reason ≥ 10, 1–240 min, confirm, idempotencyKey | IN_PROGRESS attempts in scope +N (one UPDATE); EXAM scope also moves window end | sealed never reopened | `exam.control.extend` | `(exam, key)` unique → stored result | retry with same key |
| CLOSE | ADMISSION_OPEN / LIVE / SUSPENDED / CLOSING | CLOSING, or CLOSED if nothing in progress | SUSPENDED needs `force` | none (force seals) | admission closes; force seals everyone (reason required) | `exam.control.close` | closed → no change; force escalates once | safe; reconciliation finishes an interrupted force |
| RECONCILE | LIVE … SCORING | same | none | seals only attempts expired on the DB clock | exactly-once seal | `exam.control.reconcile` | natural | safe |
| INITIATE_SCORING | CLOSED | SCORING | nothing in progress; roster non-empty | none | scored once; absentees recorded | `exam.control.initiate_scoring` | SCORING → no change | safe |

Automatic transitions by the reconciler (system actor, audited as `exam.lifecycle.*`): AUTOMATIC exams `SCHEDULED/ADMISSION_OPEN → LIVE` at window start; any exam `LIVE/CLOSING → CLOSED` when nothing is in progress (and the window is over for non-CLOSING); AUTOMATIC `CLOSED → SCORING`; `SCORING → RESULT_PENDING` when everything is graded.

## Concurrency

Every command locks the exam row (`SELECT … FOR UPDATE`). Two controllers racing serialise: the second sees the first's state and either no-ops (idempotent) or is refused with 409 and the current status. Tested: `SUSPEND` vs `CLOSE` ×3 rounds — exactly one wins, the version advances once, one event, one audit row.
