# Hostinger deployment audit (2026-11-06)

What the SZABMU OES needs from its host, what the current Hostinger plan provides, and how each fact is known.
Evidence labels: **[live]** observed on the running site · **[repo]** documented in this repository from an earlier session's account queries
(`hostinger-demo/README.md`, `hostinger-managed/01…`) · **[local]** measured on a local copy · **[unverified]** not confirmed.
No setting was changed and nothing was deployed for this audit.

## 1. Platform facts

| Item | Fact | Evidence |
|---|---|---|
| Plan | Hostinger Cloud Enterprise, managed Node.js website (no VPS, no root, no Docker) | [repo] |
| Node.js | 24 (the highest offered); the app builds and passes tests on 24 (CI job `node24`) | [repo], CI |
| Processes | one Node.js process per website; loopback ports between processes do not work (`EADDRINUSE`) → API and web run in one process (`scripts/hostinger-single-site.mjs`) | [repo] |
| Node.js sites | ~10 per account, 9 used → the production plan of 3 sites (student, staff, API) does not fit | [repo] [unverified count] |
| Database | Hostinger managed MariaDB 11.8 on the same server; 150 connections, **500 new connections per hour**, idle connections closed after 300 s, statements capped at 300 s | [repo] |
| Redis | none on the plan; the app runs without it (`/api/health` → `"coordination":"database"`) | [live] 2026-11-05 |
| Deployment | Git auto-deploy from `main`; migrations applied at start by `scripts/auto-migrate.mjs` (additive only, idempotent, non-fatal) | [repo], [live] (new tables in use after the 2026-11-02 deploy) |
| Domains/TLS | `szabmu.site`, `oes.szabmu.site`, `dashboard.szabmu.site` via Hostinger ALIAS to its CDN; TLS automatic | [live] |
| Logs | only `console.*` output reaches the runtime log | [repo] |
| Background work | no permanent worker; lifecycle reconciler runs inside the API process with a database lease; timers pause if the process is idled/restarted until the next request | [repo] |
| Cron | available on the plan [repo]; not used by this deployment | [unverified for Node] |
| Request limits | 120 s per request at the edge (affects Server-Sent Events) | [repo] [unverified] |
| CPU/RAM share | unknown | [unverified] |
| Backups | Hostinger daily backups (hPanel); a verifiable logical backup tool exists (`scripts/db-backup.mjs`) but has not been run against production | [repo] |

## 2. Requirement-by-requirement

| Requirement | Status | Notes / blocker |
|---|---|---|
| App builds and starts on Node 24 | Met | CI `node24` |
| Database connectivity, TLS | Met | `sslaccept=strict` on the MariaDB URL [repo] |
| HTTPS on both portals | Met | [live] |
| Two portals, roles bound to their portal | Met in configuration (`PORTAL_HOSTS`, `PORTAL_ENFORCE=true`) | verified live 2026-11-01 [repo] |
| Cookies | host-only, httpOnly, SameSite=Lax; `Secure` fixed in code (SEC-01), **not yet deployed** | needs deploy approval |
| Correct client IP for limits/audit | **Not met** (SEC-08: forgeable `X-Forwarded-For`) | needs the real hop count on Hostinger |
| Email delivery (sign-up, reset codes) | Configuration documented (Hostinger mailbox via SMTP); **delivery not verified live** | check `SMTP_*` in hPanel and send a test code |
| Production mode (`NODE_ENV=production` on the API, `MFA_ENFORCE=true`) | **Not met** (demo deviations) | owner decision before real exams |
| Capacity for an exam start burst | **Unknown** on Hostinger. Locally one Node process kept integrity up to 1 000 highly active candidates with degraded latency (`docs/audits/IMPLEMENTATION_TRACKER.md` §2) | staging copy + load test; the 500 new-connections/hour limit must be watched (pool `minimumIdle` is kept low for this reason) |
| Live monitoring transport | SSE with polling fallback; SSE through the Hostinger edge untested (120 s limit) | clients already fall back to polling every 8–10 s |
| Backups and restore | **Not proven** for production | run `db-backup.mjs backup` + `verify` against a copy; schedule |
| Rollback | Possible (see `ROLLBACK_AND_RECOVERY.md`) | — |
| Monitoring/alerting | `/api/metrics` exists (token); no scraper/alerting on this plan | external uptime/metrics service needs approval |

## 3. Architecture that is feasible on this plan
One Hostinger Node.js website runs the launcher: it applies pending migrations, then serves both portals and the API from a single process on
`PORT`, with all coordination in MariaDB. This is what runs today. Its limits are a single event loop (no horizontal scaling inside the plan),
no isolation between portals (a crash affects both), and timers that depend on traffic. For high-stakes examinations of thousands of
simultaneous candidates the evidence so far does **not** show this is sufficient; the options, in order of cost, are:
1. measure on a staging copy of the plan (same limits) and keep exams within the measured envelope (staggered starts per campus);
2. free Node.js slots to run the API as its own site (production plan, doc `hostinger-managed/02`);
3. move the API to a host with multiple processes (VPS or managed container platform) while keeping the web portals on Hostinger.
Choosing among them is an owner decision; nothing in the code prevents any of them.
