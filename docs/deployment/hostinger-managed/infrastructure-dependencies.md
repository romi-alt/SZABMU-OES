# Infrastructure dependencies

Every external service the design needs, who decides, and the state today. **Nothing has been created, purchased or configured.** No credential was created or requested.

| # | Dependency | Required by | Requirements | Decision owner | State |
|---|---|---|---|---|---|
| 1 | Hostinger Cloud Enterprise (`cloud_enterprise_v3`, active) | web + API sites, cron | ≥ 3 free Node.js slots (or option B/C), Node 24 | account owner | **9 of 10 slots used (unverified)** — B-01 |
| 2 | **Managed PostgreSQL 16** (staging + production, separate) | everything | doc 04 D1–D10 | university/IT | **not chosen** |
| 3 | **Managed Redis** (staging + production) | recovery tokens, queues, events, heartbeats | TLS, password, no eviction, fixed price | IT | **not chosen** |
| 4 | **Always-on worker host** (≥ 2 for HA) | lifecycle + consumers | Node 24, restart-on-failure, outbound to 2–3, no inbound | IT | **not chosen** |
| 5 | **Mail relay/provider** | recovery codes, notifications | STARTTLS **without authentication** (current code) or add SMTP auth; SPF, DKIM, DMARC for `szabmu.site` | IT | **not chosen** — B-08 |
| 6 | Object storage | question images, PDFs | private bucket, signed URLs, size/type limits | IT | **future**; no code path today — doc `09`, brief §10 |
| 7 | Monitoring/alerting + uptime checks | exam-day operations | scrape `/api/metrics`, evaluate `infra/observability/alerts.yml`, page on-call | IT | **not chosen** |
| 8 | Backup storage + encryption keys | restore | off-site, encrypted, tested | university | **not chosen** |
| 9 | GitHub repository access for Hostinger | deploys | Hostinger GitHub App with read access to this repo | account owner | **unknown** |
| 10 | DNS | public hostnames | records exactly as hPanel shows | account owner | zone exists; no `oes`/`dashboard`/`api` records |

## Cost
No prices are asserted: they were not obtainable in this session and they change. Cost lines to obtain before approval: items 2, 3, 4, 5, 7, 8 (monthly, at exam-day size), plus egress.

## Object storage (brief §10) — current state
The configuration schema reads `S3_*` and the CSP has `CSP_MEDIA_ORIGIN`, but no code uploads, signs or serves objects `[CODE]`. Nothing durable (images, PDFs) may be written to the deployed application directory. When implemented: private bucket, short-lived signed URLs after an authorisation check, size and MIME-type limits server-side, retention and backup rules, unpublished papers never public.
