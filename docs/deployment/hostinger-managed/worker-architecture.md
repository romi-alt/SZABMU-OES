# Worker architecture

Evidence labels as in `01-hosting-capability-audit.md`.

## Why a separate worker
Hostinger managed Node.js hosting does not run permanent background processes and stops endless timers on deploy/restart `[HOSTINGER-DOCS*]`. The API's lifecycle loop and BullMQ consumers are started only when `RUN_WORKERS=true` `[CODE]` (`jobs.service.ts:21`, `control/lifecycle.service.ts:43`). On Hostinger the API therefore runs with `RUN_WORKERS=false` and a second deployment runs the work.

## Entries (all in `apps/api/src`, compiled to `apps/api/dist`)
| Entry | Purpose | Lifetime |
|---|---|---|
| `main.ts` | HTTP API | request/response (Hostinger) |
| `worker.ts` **(new)** | forces `RUN_WORKERS=true`, boots Nest **without HTTP**, keeps the loop alive, graceful on SIGTERM | always-on, **external host** |
| `cron/reconcile.ts` **(new)** | one lifecycle pass + mail retry, exit 0 / 1 / 2 | finite (Hostinger cron or an operator) |

## What the worker does `[CODE]`
1. **Lifecycle reconciler** (`LifecycleService`, every `LIFECYCLE_INTERVAL_MS`=5 s): auto-submit expired attempts → auto-open → force-close → close → start scoring → progress scoring → backstop grading → publish pending exam events. Each pass takes a **database lease** (`lifecycle_leases`, `LIFECYCLE_LEASE_SECONDS`=15), renews between steps, has a 20 s budget, and records itself in `lifecycle_runs`. Row claims use `SKIP LOCKED`; every transition is a guarded UPDATE; finalize is idempotent.
2. **BullMQ consumers**: grade (concurrency 16) and mail (4). Accelerators only: the backstop grades whatever the queue missed.
3. A bounded retry per attempt (`MAX_ATTEMPT_RETRIES=5`) so a poison attempt cannot loop forever.

## Properties that make it safe to run unattended
- **Safe twice.** A second worker (or the cron command) finds the lease held and reports `skipped`; even if two ran together, every step is guarded, so work is not duplicated. Run **two** workers on different hosts for availability.
- **Crash-safe.** A dead owner's lease expires in ≤ 15 s; the next process reconciles the whole backlog immediately on start (`loop()` runs once at bootstrap).
- **Redis-independent.** The reconciler's scheduling and state live in PostgreSQL; Redis is used only to push events faster.
- **Not what enforces deadlines.** The API rejects late writes and seals expired attempts on its own (doc `deadline-safety.md`).

## Liveness and alerting
`oes_lifecycle_last_success_age_seconds` (from `lifecycle_runs`) is exposed at `/api/metrics` (bearer token) and is the signal for "no worker has completed a pass". Alert at > 30 s during an exam window, page at > 120 s. Also watch `oes_exam_events_pending` / `oes_exam_events_oldest_pending_seconds` (outbox backlog) `[CODE]`. The shipped rules (`infra/observability/alerts.yml`) assume a Prometheus scrape; the hosting needs an external uptime/metrics service to evaluate them (not chosen).

## Deploying the worker (external host)
Node 24; `npm ci && npm run build:api`; start `npm run start:worker`; the same environment variables as the API (doc 08) including identical `COOKIE_SECRET`, `RECEIPT_SECRET`, `MFA_KEY`; outbound access to PostgreSQL, Redis and the mail relay; restart-on-failure; no inbound port; 256–512 MB. Provider not chosen.

## Verified
Only that the files compile **if** CI's `node24` and `verify` jobs pass; the worker has never been started against a real PostgreSQL/Redis in this session. See `reliability-test-results.md`.
