# 06 — Redis failure and recovery

## What used Redis, and what happens now

| Concern | Before | Now |
|---|---|---|
| Auto-submit, open/close, absentees, result review | BullMQ repeatable job (Redis) | `LifecycleService`: database lease + reconciler loop. **No Redis involvement.** |
| Grading | BullMQ queue + sweeper backstop | queue is an accelerator; the reconciler grades sealed attempts from the database |
| Deadline enforcement | save predicate (DB) + lazy seal | unchanged, **plus** seal re-check under the row lock; independent of any worker |
| Event delivery | none | outbox in PostgreSQL; Redis pub/sub only for latency; DB catch-up when Redis is slow/down |
| Connection counts | whole `hb:` hash scan | sorted sets `hbz:<exam>[:<campus>]` (ZCOUNT/ZSCORE); `null` + degraded flag if Redis is down |
| Login/save rate limits | fail open | unchanged (policy P-28) |

## The reconciler

- **Ownership**: `lifecycle_leases` row; atomic claim (`INSERT … ON CONFLICT DO UPDATE WHERE expired OR mine`); a crashed owner's lease expires (30 s, configurable `LIFECYCLE_LEASE_SECONDS`).
- **Safe without ownership too**: every step is idempotent (guarded UPDATE, `FOR UPDATE SKIP LOCKED`, seal-under-lock). A second process running concurrently cannot double-seal.
- **Recovery**: a (re)started process runs immediately, reconciling the whole backlog in bounded batches (200 per batch, 8 in parallel, 20 s budget per pass, remaining work continues next pass).
- **Bounded retries**: an attempt that fails to seal 5 times stops being retried (`lifecycleRetries`), is counted in `poisoned` (health + alert), and remains unwritable because the API enforces the deadline itself.
- **Audit**: automatic transitions are audited as `exam.lifecycle.*` (actor null) in the same transaction as the event.
- **Metrics**: `oes_lifecycle_runs_total{outcome}`, `oes_lifecycle_transitions_total{kind}`, `oes_lifecycle_last_success_age_seconds` (read from PostgreSQL, so it reflects *any* process), `oes_exam_events_pending`, `oes_exam_events_oldest_pending_seconds`.

## Tested on disposable infrastructure (`test-fault/control.test.ts`, 3 tests pass)

1. **Redis killed mid-exam**: saves keep returning 200; an attempt pushed past its deadline is refused by the API (`TIME_EXPIRED`) and then sealed by the PostgreSQL reconciler exactly once; an exam-wide extension (control command) succeeds; its event stays PENDING in the outbox, reaches a staff SSE client **from the database while Redis is down**; the control view reports `redis.available=false`, `freshness.degraded=true`, `online=null` (no invented number) with correct DB-derived `inProgress`; after Redis returns the outbox drains to DELIVERED with zero FAILED.
2. **API killed (SIGKILL) with a backlog**: three attempts expire while no process runs; on restart all three are sealed within seconds, each exactly once, answers intact; a client reconnecting with its pre-crash cursor receives the event it missed.
3. **Two API processes**: ten-ish attempts sealed exactly once with unique receipts; the lease belongs to one of them; the leader is killed; the survivor takes the lease and seals the next expired attempt.

In-process tests add: lease takeover after expiry, a non-leader pass reports `skipped`, four concurrent reconcile passes over a nine-attempt backlog seal each exactly once, poison-attempt bounding and operator recovery, legacy AUTOMATIC exams still open/close with events and audit.

## Not covered

Redis restarting with *data loss* mid-exam beyond what the outage test shows (heartbeat sets repopulate within one heartbeat interval); PostgreSQL failover (single database); clock skew between API hosts (all decisions use the database clock, so skew does not affect lifecycle correctness).
