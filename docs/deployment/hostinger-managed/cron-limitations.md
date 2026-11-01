# Cron limitations

## What Hostinger cron offers `[HOSTINGER-DOCS*]`
Scheduled finite commands (the brief states a 30-minute execution limit); a minimum interval measured in minutes (**not verified**); a small number of jobs on lower plans, unlimited on Premium and above; processes count against the plan's process limit; a cron process cannot be a daemon.

## What it is used for here
`npm run reconcile` (`apps/api/src/cron/reconcile.ts`): one lifecycle pass (seal expired attempts, open/close, scoring, backstop grading, publish events) **plus** `MailService.retryUndelivered()`, then exit. Exit codes: 0 completed or `skipped` (a worker holds the lease), 1 failed, 2 timed out (`RECONCILE_TIMEOUT_MS`, default 120 s).
Suggested schedule: **every minute during an exam window**, every 15 minutes otherwise; plus finite housekeeping (report preparation, reminders) if those features are added.

## What it cannot do
| Claim | Reality |
|---|---|
| "Second-level deadline guarantees" | **No.** The best case is the cron interval plus jitter plus the pass's runtime (≈ 1–2 minutes). |
| "Replaces the worker" | **No.** It never runs between ticks; mail and event latency are minute-scale; BullMQ consumers do not run at all. |
| "Safe to run as a loop" | **No.** An endless process would be killed at the limit and would count against NPROC. The command refuses to loop by design. |

## Why this is still safe
The API enforces the deadline on every request against the database clock; the cron pass only moves state that nothing touched. Running it next to a worker is harmless (lease → `skipped`).

## When cron is the *only* runner (reduced mode)
Acceptable only for a **supervised pilot** with staff on duty: expect receipts/grades/results up to ~1–2 minutes after the event; staff use control commands (`close`, `reconcile`) for time-critical transitions; synchronized starts should use MANUAL control. Not acceptable for an unattended examination.

## Verification status
Not run. Doc 10 C-5 (two concurrent runs) and C-3 (stopped worker, late save, reconcile) cover it.
