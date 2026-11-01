# Failover and recovery

What happens, what the system guarantees, and what an operator does. "Tested" means a test exists in the repository (`apps/api/test-fault`, e2e) that exercises it on **local disposable infrastructure** (reported by the UI/UX/control session; **not re-run here**). None of this has been run on the Hostinger topology.

| Failure | Guarantee (from the code) | Operator action | Existing test |
|---|---|---|---|
| API site restarted / redeployed mid-exam | Acknowledged answers are in PostgreSQL; clients retry idempotently; the same receipt is replayed on a repeated submit | none; confirm `oes_lifecycle_last_success_age_seconds` stays low | `fault.test.ts` A, B, C |
| Hostinger site recycled by the platform (process limit, deploy) | same as above; **SSE connections drop** and reconnect with `Last-Event-ID` | none | A, `control.test.ts` "killed and restarted with a backlog" |
| Redis down or flushed | saves, start, heartbeat, submit continue; recovery tokens and rate limits degrade; monitor shows degraded; events still delivered from the outbox/DB | restore Redis; users re-request recovery codes | `fault.test.ts` E, `control.test.ts` "Redis lost…" |
| Worker down | deadlines still enforced by the API; sealing/grading/state moves wait for the next API touch, the cron backstop or staff | restart the worker; run `npm run reconcile` once | `control.test.ts` "two workers and leader failover" |
| Worker restarted (graceful or SIGKILL) | next process reconciles the whole backlog at start; each attempt sealed once | none | same |
| Two workers at once | one holds the lease, the other skips; sealing is exactly-once | none | same |
| PostgreSQL primary fails over / restarts | in-flight statements fail; clients retry; no acknowledged answer is lost (durable commits) | follow the provider's failover; check `/api/health` | `fault.test.ts` D (crash + WAL recovery, local) |
| Provider region outage | exam unavailable; data safe if PITR/replica exists | restore into a new instance (measured RTO required) | `backup-restore.test.ts` (logical restore only) |
| Mail relay down | recovery codes queue in `outbound_messages`; **no automatic retry existed**; `retryUndelivered()` added (cron) | restore relay; run reconcile | not tested |
| Bad deploy | previous Git commit redeployed from hPanel | redeploy; run migrations only if forward-compatible | doc 10 D-3 |
| Lost/changed environment variables (full replace) | the API refuses to boot on an unsafe/incomplete production config (`productionProblems`) | restore from the controlled checklist | `config.test.ts` |

## Recovery principles
1. **Never** restore Redis from a backup (nothing authoritative lives there).
2. Database restore = provider PITR to a **new** instance, run the verification of doc 10 D-2 (counts, trigger presence, `GET /api/audit/verify` → `brokenAt: null`), then repoint `DATABASE_URL` on the API site, the worker and the cron environment (full-replace variable sets — change all three).
3. After any outage during an exam window: run `npm run reconcile`, check that no attempt is `IN_PROGRESS` past its deadline, then check the outbox backlog metric.
4. Record the incident, the commit, the data window at risk (RPO), and the measured RTO.

## Not designed (state it)
Automatic multi-region failover; zero-downtime schema migrations for destructive changes; a standby Hostinger account.
