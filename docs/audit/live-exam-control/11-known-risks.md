# 11 — Known risks, limits and decisions needed

## Decisions that need institutional approval (not silently assumed)

| Decision | Current behaviour | Why it needs a human decision |
|---|---|---|
| **Suspension time policy** (P-30) | Undecided by default: `suspendTimePolicy = NULL` → SUSPEND is refused until an approver (`exam.control.policy`: CCE / Super Admin) sets FREEZE_CLOCK or CLOCK_CONTINUES for that exam; the approver and time are stamped and audited. The code supports both. | Whether lost time is returned to candidates is an academic-regulation question. |
| **Timing policy per exam** | Stored on the exam (`INDIVIDUAL` default, `SYNCHRONIZED` optional), changeable only before candidates start. | Which exams use one official clock is an examinations-office choice. |
| Approver model for extensions | The acting CCE/Super Admin is recorded as approver (`approvedBy`) with a mandatory reason. There is no second-person approval step. | Four-eyes for extensions would be a policy addition. |
| Roles | No separate "Institution Administrator"; CCE is university-wide by role. | Matches the data model; a distinct tier or per-CCE scope is a design decision (D-20). |
| Window end under group extension | EXAM-scope extension also moves `closesAt`; CAMPUS/CANDIDATES scope does not. | Confirm that a late entrant should share an exam-wide extension. |

## Measured/known engineering risks

| Risk | State |
|---|---|
| **Scale** | Nothing here demonstrates 5,000/10,000/20,000 candidates. See `10-performance-results.md`: 2,000-candidate runs only, on one shared 4-vCPU box, with large run-to-run variance. No staging environment was available and none was assumed. |
| **Reconciler under load** | Measured effect with workers active is reported in `10`; the single-run variance on this box is large and unexplained. |
| **Reconciler throughput** | ≤ 200 attempts per batch, 8 in parallel, 20 s budget per pass: a mass expiry of 20,000 attempts needs several passes (minutes). Not load-tested. |
| **Per-process metrics** | Save success rate and API-error figures on the control centre are *this API process since start*; with several API processes they are not an exam-wide aggregate (labelled as such). |
| **Scrape-time gauge** | The existing `oes_campus_candidates` gauge still reads every in-progress attempt (cached 15 s) and the `hb:` hash. It predates this work and does not scale to 20,000; the monitor uses the new sorted sets. |
| **Heartbeat write cost** | Each heartbeat now also writes two sorted-set entries and joins `exams`/`students` for the state it returns. Overhead measured in `10`. |
| **SSE caps and proxies** | 4 streams/user, 20,000/process. Behind a buffering reverse proxy SSE may be delayed (`X-Accel-Buffering: no`, `no-transform` are set; no proxy was available to test). Clients fall back to heartbeat (≤ 15 s). |
| **Event ordering across campuses** | The cursor is global per database; per-exam ordering is by id. A reconnect with a stale cursor older than 500 events gets `resync`. |
| **Outbox growth** | `exam_events` is append-only and small (state changes only, not saves); no retention job yet. |
| **Notification volume** | Group suspend/resume/extend create one notification per affected candidate (up to 20,000 rows) after commit; not load-tested. |
| **Control centre UX** | Desktop-first, dense; not audited for accessibility or phone layout; candidate selection is by checkbox on the current page only. |
| **Answer keys** | Still plaintext at rest (P-27); rate limiters still fail open without Redis (P-28). |

## Not verified

PostgreSQL failover; reverse proxy/TLS; Firefox/Safari; behaviour with several hundred simultaneous controllers; clock skew between hosts (decisions use the database clock, so it should not matter, but it was not tested); the `exam.control` flow under MFA enforcement in the browser (the guard is the existing one and the API tests cover MFA separately).

## Not claimed

Pilot readiness; capacity at any size beyond what `10` measured; that the control centre has been used for a real examination.
