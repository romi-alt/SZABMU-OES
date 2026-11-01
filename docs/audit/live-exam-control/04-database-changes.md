# 04 — Database changes

Two additive migrations (apply cleanly from an empty database — verified on a fresh cluster and by the test global setup): `20261101002107_exam_live_control`, `20261101002607_exam_force_close`. No existing column or row is altered or dropped; defaults preserve legacy behaviour (`controlMode AUTOMATIC`, `timingPolicy INDIVIDUAL`). **The shared development database was not migrated** by this work.

| Object | Change |
|---|---|
| `ExamStatus` | + `ADMISSION_OPEN`, `SUSPENDED`, `CLOSING`, `SCORING` |
| enums | `TimingPolicy`, `ControlMode`, `SuspendTimePolicy`, `SuspensionScope`, `ExtensionScope`, `EventDelivery` |
| `exams` | + `timingPolicy, controlMode, suspendTimePolicy, controlPolicyApprovedBy/At, officialStartAt, admissionOpenedAt, admissionClosedAt, closedAt, forceCloseAt, stateVersion`; index `(status, closesAt)` |
| `attempts` | + `suspendedAt, suspensionId, lifecycleRetries, lifecycleError`; indexes `(examId, suspensionId)`, partial `(examId) WHERE suspendedAt IS NOT NULL` |
| `exam_suspensions` | scope, campus, candidate ids, reason, incident, time policy, who/when suspended and resumed, `pausedSeconds`; CHECK on scope shape; partial index on open rows |
| `exam_extensions` | scope, minutes (CHECK 1–240), reason, `approvedBy`, `(examId, idempotencyKey)` unique, affected count, window before/after |
| `exam_commands` | idempotency ledger `(examId, idempotencyKey)` unique |
| `exam_events` | **transactional outbox + durable transition log**: `id` (cursor), `eventId`, `examId`, `institutionId` (campus scope), `studentId`, `aggregateVersion`, `type`, `payload`, `createdAt` (`clock_timestamp()`), `deliveryStatus`, `retryCount`, `deliveredAt`; **trigger**: no DELETE, only delivery columns updatable; partial index on PENDING |
| `lifecycle_leases` | ownership claim for the reconciler (a dead owner's lease expires) |
| `lifecycle_runs` | one row per reconciler pass (instance, duration, stats, error); pruned after 2 days |
| `exam_candidates` | index `(examId, institutionId)` for scoped counts |

Audit: `AuditService.append(tx, …)` writes the hash-chained record inside the command's transaction, so `exam_events`, `exams.stateVersion` and `audit_logs` always agree (tested: 7 commands → 7 events with contiguous versions → 7 audit rows).

Transaction handling: commands take `SELECT … FOR UPDATE` on the exam row first and the global audit-chain lock last; reconciler steps claim rows with `FOR UPDATE SKIP LOCKED`; seal re-checks expiry under the attempt row lock.
