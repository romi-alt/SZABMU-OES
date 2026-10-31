# Observability: metrics, alerts and runbook

`GET /api/metrics` (Prometheus text format). **Disabled (404) unless `METRICS_TOKEN` is set; then requires `Authorization: Bearer <token>`.** `METRICS_TOKEN` is mandatory in production (config validation). Do not expose the path publicly — scrape from inside the network.

```yaml
# prometheus.yml (excerpt)
rule_files: [infra/observability/alerts.yml]
scrape_configs:
  - job_name: oes-api
    metrics_path: /api/metrics
    authorization: { type: Bearer, credentials_file: /etc/prometheus/oes-metrics-token }
    scrape_interval: 15s
    static_configs: [{ targets: ['api-1:4000', 'api-2:4000'] }]
```
With several API processes, counters are per process; always `sum()` across instances (the shipped rules do). Campus connectivity gauges are computed from shared Redis/PostgreSQL state, so every instance reports the same value — use `max by (institution)` when graphing.

## What is measured
| Signal requested | Metric(s) | Notes |
| --- | --- | --- |
| Successful answer writes | `oes_answer_save_total{result="ok"}` (+ `duplicate`) | counted only after the durable commit is acknowledged |
| Failed answer writes | `oes_answer_save_total{result=error\|expired\|stale\|superseded\|closed\|rejected\|rate_limited\|out_of_sync}` | `error` = server fault (pages); the rest are client/state outcomes |
| Answer-save latency | `oes_answer_save_duration_seconds` (histogram) | includes rejected saves; use `histogram_quantile` |
| Submission errors | `oes_submit_total{result=ok\|replayed\|error\|…}`, `oes_submit_duration_seconds` | |
| Database failures | `oes_db_up` (probe on every scrape), `oes_db_errors_total{kind=connection\|query}` | errors that surfaced as HTTP 500 |
| Campus disconnections | `oes_campus_candidates{institution,state=connected\|disconnected}`, `oes_active_attempts` | from client heartbeats (15 s; stale after 45 s or client-reported offline); cached 15 s; candidates started < 60 s ago count as connected; **no series are emitted while Redis is down** (unknown ≠ disconnected) |
| Authentication failures | `oes_auth_failures_total{kind=login_invalid\|login_locked\|login_rate_limited\|mfa_invalid\|mfa_locked}`, `oes_auth_success_total` | |
| Unauthorized API requests | `oes_unauthorized_requests_total{status=401\|403,code}` | counted for every guard/service rejection |
| General | `oes_http_requests_total{method,route,status}`, `oes_http_request_duration_seconds`, `oes_unhandled_errors_total`, `oes_redis_up`, `oes_event_loop_lag_seconds`, `oes_process_*` | `route` is the route pattern, never the raw URL or an id |

**Privacy:** no user identifiers, emails, IPs, tokens or answers appear in any label (verified by test: no ids in labels).

## Alerts (`infra/observability/alerts.yml`)
14 rules in three groups: exam integrity (save failures ratio/any, slow p99 >1 s / >3 s, submission errors), platform (API down, DB down, DB errors, Redis down, 5xx ratio, event-loop lag) and campus/security (campus >20% disconnected with ≥10 candidates, failed-auth rate, lockouts, 403 and 401 spikes). **Thresholds are starting points** derived from the 2,000-candidate run (save p99 ≈ 250 ms) — re-tune after the first rehearsal. `apps/api/test/metrics.test.ts` fails if a rule references a metric the API does not expose or lacks a runbook anchor here.

**Not provided:** the Alertmanager routing (who is paged, escalation, quiet hours), dashboards, log aggregation, distributed tracing, uptime probes from outside, SLO definitions. Alerts have been *validated structurally*, not fired against a live Prometheus (no Prometheus/`promtool` in the build environment).

## Runbook
### Answer save failures
`OESAnswerSaveFailures` / `…AnyErrors`: candidates keep working (the client queues and retries; nothing is acknowledged unless committed). 1) `oes_db_up`, `oes_db_errors_total` — database trouble? 2) API logs for the exception (stack is logged, never sent to clients). 3) Connection pool exhaustion (`DB_POOL_MAX`) — look for rising latency first. 4) After recovery, confirm `committed-but-unacknowledged` writes reconcile: candidates' next save is an idempotent no-op.
### Slow saves
p99 > 1 s: check CPU / `oes_event_loop_lag_seconds`, PostgreSQL load and connection count, `answer_events` size (partitioning is not implemented), Redis latency. Scale API processes; place PgBouncer before PostgreSQL.
### Submission errors
Any `result="error"` is urgent: candidates cannot get a receipt. Their answers are already durable; once the fault is fixed they can retry (idempotent) and the lifecycle sweeper will auto-submit expired attempts.
### API down
Check the process/pod, `GET /api/health`, recent deploy. Candidates' browsers retry; no answers are lost while the API is down because none are acknowledged.
### Database down
Exams cannot proceed (no saves). Restore service; do not restart candidates' browsers. If data corruption is suspected, stop and follow `docs/operations/backup-restore.md`.
### Redis down
Degraded, not down: saves, submits and sign-in continue (measured: login 0.35 s, submit 15 ms during a hard outage). Live monitor shows stale connectivity; rate limiting is fail-open; password reset is unavailable.
### Campus disconnections
`OESCampusDisconnected` for one institution = that campus's network/ISP. Notify the campus invigilator; candidates continue offline (answers buffer in the browser and sync on reconnect); consider an exam-wide extension *per policy P-23 (tool not built — use per-candidate extension)*.
### Authentication failures
Spike of `login_invalid`/`mfa_invalid`: credential stuffing or a bad deploy. Lockouts are per account (5 failures/15 min). Many `login_locked` before an exam = candidates locked out — helpdesk unlock procedure.
### Unauthorized requests
403 spikes: someone probing other campuses/roles (see the audit log for actor and route) or a front-end bug. 401 spikes: session expiry/cookie domain issue or scanning.
