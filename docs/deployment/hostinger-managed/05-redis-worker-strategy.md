# 05 — Redis and worker strategy

## Every Redis / BullMQ dependency in the code, classified `[CODE]`

Classes: **CRITICAL_SYNCHRONOUS** (a user-visible request fails without it) · **CRITICAL_BACKGROUND** (work is lost or stuck without a consumer) · **BEST_EFFORT** (degrades, recovers) · **CACHE_ONLY** (database is the fallback).

| Use | File | Class | If Redis / the consumer is down |
|---|---|---|---|
| Sign-in / recovery / save / verify rate-limit counters (`rl:*`) | `auth.service.ts`, `delivery.controller.ts`, `results.controller.ts` | BEST_EFFORT | fail **open** (documented policy P-28); account lockout is database-backed and unaffected |
| Session cache (`sess:*`, `usess:*`, 120 s) | `common/auth.ts`, `auth.service.ts`, `mfa.service.ts` | CACHE_ONLY | falls back to the `sessions` table |
| Approved paper cache (`paper:*`) | `delivery.service.ts` | CACHE_ONLY | reads the immutable paper from PostgreSQL |
| Heartbeat sorted sets/hashes (`hb:*`, `hbz:*`) | `delivery.service.ts`, `monitor.service.ts`, `metrics.service.ts` | BEST_EFFORT | monitor reports connection state as unavailable/degraded, never wrong; answers unaffected |
| Live-event pub/sub (`oes:exam:*`) | `control/events.service.ts` | BEST_EFFORT | events are committed to an **outbox table first**; subscribers also catch up from PostgreSQL; only latency suffers |
| **Password-reset token** (`rt:*`, `SET … EX`, `GETDEL`) | `auth.service.ts` | **CRITICAL_SYNCHRONOUS** (recovery only) | `forgot → verify-code` fails; no exam path is affected |
| BullMQ **grade** queue | `delivery.service.ts` (enqueue), `jobs.service.ts` (consumer) | BEST_EFFORT | the lifecycle `gradeBackstop` grades every sealed attempt without a result; enqueue is time-boxed so a receipt is never delayed |
| BullMQ **mail** queue | `infra/mail.service.ts` (enqueue), `jobs.service.ts` (consumer) | **CRITICAL_BACKGROUND** (recovery codes, notifications) | the message stays in `outbound_messages` **unsent** — there was no database-driven retry. **Fixed in this branch:** `MailService.retryUndelivered()` run by the reconcile command |
| Lifecycle reconciler (auto-submit, open/close, scoring, backstop grading, event publishing) | `control/lifecycle.service.ts` | **CRITICAL_BACKGROUND**, but **Redis-free**: PostgreSQL lease (`lifecycle_leases`), `SKIP LOCKED`, idempotent | needs *a process that runs it*, not Redis |

**Conclusion:** Redis is never what makes an acknowledged answer safe. It is required for password recovery tokens and for fast events/monitor/mail; the lifecycle needs a runner. Redis is therefore **an external managed service**, not removable without code change (the earlier "remove Redis" branch, PR #3, would make recovery tokens database-backed; it is stale against the foundation and not part of this plan).

## Redis service requirements
TLS (`rediss://`) and a password (the production gate refuses `REDIS_URL` without one); **fixed-price or generous command quota** (BullMQ polls and publishes — a per-command-priced tier can be expensive; pricing **not verified here**); `noeviction` or a plan that never evicts BullMQ keys; no data-loss expectation (nothing authoritative lives in Redis); a region near the worker host.

## Where the always-on part runs

The lifecycle reconciler and BullMQ consumers are started by `RUN_WORKERS=true`. On managed hosting they must **not** run inside a web process (the brief and the platform both forbid it), so:

| Process | `RUN_WORKERS` | Entry |
|---|---|---|
| API on Hostinger | **false** | `apps/api/dist/main.js` |
| **Worker on an external always-on host** | forced true | `npm run start:worker` → `apps/api/dist/worker.js` (**new**; `npm run worker` used to point at a missing file) |
| Hostinger cron (backstop) | forced false | `npm run reconcile` → one finite pass + mail retry, exit code 0/1/2 |

Candidates for the worker host: any platform that keeps a Node 24 process running, restarts it on failure and gives outbound access to PostgreSQL and Redis (container PaaS or a small VM). Choice, region and price are the account owner's decision and are **not made or priced here**. A worker needs ~256–512 MB and no inbound port. (The Hostinger VPS the account already owns is suspended and excluded by the brief.)

## If no always-on worker is available (reduced mode)
Possible only with these consequences, all `[CODE]`-derived and **untested as a whole**: attempts past their deadline are sealed lazily when the candidate's client hits `start`/`heartbeat`/`submit` (the API enforces the deadline on every write regardless); exams do not auto-open/close/score unless staff run control commands (MANUAL control mode) or the cron backstop runs; grading waits for the backstop; recovery e-mail depends on the cron mail retry (≥ 1 minute late). This is acceptable for a supervised pilot with staff on duty, **not** for an unattended exam. See `release-blockers.md`.
