# Hostinger demo deployment (live) — what, why, how

> **This is a seeded DEMO, not production.** All accounts are synthetic (`@demo.szabmu.invalid`, password `Demo-Passw0rd-2026!`).
> Production rules (two portals, MFA, `NODE_ENV=production` on the API) are deliberately **not** active here — see "Deviations from the production plan".
> For the real production plan read [`../hostinger-managed/`](../hostinger-managed/) and its `release-blockers.md`.

## At a glance

| Item | Value |
|---|---|
| Student portal | https://oes.szabmu.site (candidates sit exams) |
| Staff dashboard | https://dashboard.szabmu.site (college / university roles) |
| Original free URL | https://yellowgreen-grasshopper-337716.hostingersite.com (mapped to the student portal) |
| Health check | `GET /api/health` → `{"status":"ok","db":true,"redis":true}` |
| Hosting | Hostinger Cloud Enterprise (order `1009002313`, hPanel user `u943531942`), **one** managed Node.js website |
| Node.js | 24 (highest Hostinger offers; CI job `node24` is green for build/typecheck/lint/tests) |
| Source | GitHub `romi-alt/SZABMU-OES`, branch `main` — Hostinger Git auto-deploy rebuilds on every push |
| PostgreSQL | **Neon** free tier, project `szabmu-oes-us` (`muddy-tooth-28867630`), PG 16, region `aws-us-east-1` — same coast as the Hostinger web server (`us-bos-web1774`, Boston). The first project `szabmu-oes` (Singapore, `empty-voice-15975689`) is no longer used |
| Redis | **Upstash** free tier (one database allowed), `szabmu-oes`, TLS (`rediss://`), 500k commands/month. Created in `ap-southeast-1`; **to be recreated in `us-east-1`** (the free tier allows one database, so the old one must be deleted first) |
| Entry point | `scripts/hostinger-single-site.mjs` (`npm run start:hostinger`) |

## Why it looks like this

1. **Hostinger has no PostgreSQL and no Redis.** Its managed databases are MySQL only; the exam engine depends on PostgreSQL features
   (`clock_timestamp()`, `ON CONFLICT … WHERE`, `SKIP LOCKED`, advisory locks, PL/pgSQL triggers) and on Redis (sessions/recovery, BullMQ, SSE fan-out).
   Both are therefore external managed services (Neon + Upstash free tiers), reached over TLS.
2. **Only one Node.js slot was free** on the account (9 Node.js sites already exist; limit ≈10). The production plan wants three sites
   (student web, staff web, API). The demo collapses them into **one process tree**:
   - one Node HTTP server listens on Hostinger's `PORT`;
   - requests to `/api/*` are handed to the NestJS API **in the same process** (its Fastify instance, `fastify.routing(req, res)`);
   - everything else goes to the Next.js request handler.
   The browser still only calls same-origin `/api/*`, exactly as in development.
3. **No second port.** A first version ran the API as a child process on `127.0.0.1:47321` behind Next's rewrite. On Hostinger's shared
   web server that failed: the child got `EADDRINUSE` on the loopback port while connections to it were refused (see "Lessons").
   `API_INTERNAL_URL` / `API_PORT` are therefore unused by the demo (left set; harmless).
4. **Remote database latency.** Every query is an internet round trip, so Prisma's default 5 s interactive-transaction timeout was too tight
   (the seed's paper-approval transaction failed with `P2028`). Defaults are now `DB_TX_MAX_WAIT_MS=10000` / `DB_TX_TIMEOUT_MS=30000`
   (`apps/api/src/config.ts`, `apps/api/src/infra/prisma.service.ts`); explicit per-transaction options in the code still take precedence.
5. **Node 24, not 26.** Hostinger offers 18/20/22/24. The `node24` CI job passed build, typecheck, lint and unit/API tests, so `engines` was relaxed to `>=24`.

## How it was done (reproducible)

1. **Neon** (console, signed-in browser): created project `szabmu-oes-us`, PG 16, `aws-us-east-1`. Copied the owner connection string (`sslmode=require`).
2. **Upstash** (console): created Redis `szabmu-oes`, Free plan, AWS Singapore. Used the TCP `rediss://default:<token>@<host>:6379` URL.
3. **Schema + demo data**, from a workstation (never from the Hostinger build — see `../hostinger-managed/04-database-requirements.md` D10):
   ```bash
   export DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' REDIS_URL='rediss://…upstash.io:6379'
   npm run build:api
   npm run db:migrate
   NODE_ENV=development DB_TX_TIMEOUT_MS=600000 DB_TX_MAX_WAIT_MS=60000 node apps/api/dist/seed/seed.js --reset
   # SYNTHETIC data. Over a slow/remote link the seed's big transactions exceed even 30 s (P2028), hence the long limits here.
   ```
4. **Hostinger website:** generated a free subdomain (`hosting_domains_generate-free-subdomain`) and created the website on order `1009002313`.
5. **Environment variables** (hPanel → Websites → the site → Node.js → Environment variables, or `hosting_nodejs_replace-environment-variables`;
   it is a *full replace*). Real values live only in Hostinger (and the operator's password manager) — never in git:

   | Variable | Value / note |
   |---|---|
   | `DATABASE_URL` | Neon connection string, `sslmode=require` |
   | `REDIS_URL` | Upstash `rediss://…` |
   | `COOKIE_SECRET`, `RECEIPT_SECRET`, `MFA_KEY`, `METRICS_TOKEN` | independent random values (≥ 36 bytes base64url) |
   | `API_INTERNAL_URL` | `http://127.0.0.1:47321` (**build-time**) |
   | `API_PORT` | `47321` |
   | `API_NODE_ENV` | `development` (demo; see deviations) |
   | `WEB_ORIGIN` | `https://oes.szabmu.site,https://dashboard.szabmu.site,https://yellowgreen-grasshopper-337716.hostingersite.com` |
   | `TRUST_PROXY` | `true` (behind Hostinger's edge) |
   | `DEV_EXPOSE_CODES` | `false` |
   | `RUN_WORKERS` | `true` (BullMQ consumers + lifecycle reconciler run inside the API child) |
   | `PORTAL_ENFORCE` | `true` |
| `PORTAL_HOSTS` | `oes.szabmu.site=student,dashboard.szabmu.site=staff,yellowgreen-grasshopper-337716.hostingersite.com=student` |
| `MFA_ENFORCE` | `false` (demo) |

6. **Deploy:** `hosting_deploy` with `git: { repository: "romi-alt/SZABMU-OES", branch: "main" }`, `type: nodejs`, Node 24,
   app type `other`, root `.`, build script `build`, entry file `scripts/hostinger-single-site.mjs`. Auto-deploy is on: every push to `main` rebuilds.
   Poll `hosting_get-deployment` until the build is `completed` or `failed`.
7. **Verify:** `curl https://<domain>/api/health` and sign in as `student.a002@demo.szabmu.invalid` / `cce@demo.szabmu.invalid`.

## Two portals on one site (student / college dashboard)

The platform has two faces: the **student portal** (candidates sit exams) and the **staff dashboard** (college/university roles).
The production plan gives each its own Node.js site; this account has no free slot, so the single process serves both and decides
per request from the `Host` header:

```
PORTAL_HOSTS="oes.szabmu.site=student,dashboard.szabmu.site=staff"
PORTAL_ENFORCE=true
WEB_ORIGIN="https://oes.szabmu.site,https://dashboard.szabmu.site"
```

- The launcher overwrites `X-OES-Portal` on every request from `Host` (client-sent values and `X-Forwarded-Host` are ignored).
- The API refuses a role on the wrong portal (`PORTAL_ENFORCE`); the web proxy 404s pages of the other portal (`PORTAL_FROM_HEADER`, set by the launcher).
- Cookies are host-only, so sessions never cross portals.
- Verified locally: student↔student 200, staff↔staff 200, cross-portal sign-in 401, spoofed header 401, `/exams` only on staff, `/register` only on student.

Hostname requirement: Hostinger's free `*.hostingersite.com` domains accept neither subdomains nor parked domains, so the two portals
use the account's real domain `szabmu.site`. **Live since 2026-11-01:** `oes.szabmu.site` and `dashboard.szabmu.site` are parked on this
website (DNS: Hostinger `ALIAS` → `*.cdn.hstgr.net`, TLS issued automatically); `PORTAL_HOSTS` also maps the free URL to `student`.
Live check: student on oes 200, CCE on dashboard 200, cross-portal 401 both ways, `/exams` 404 on oes and 200 on dashboard.

## Operating it

| Task | How |
|---|---|
| Redeploy | push to `main` (auto-deploy), or `hosting_nodejs_start-build` / `hosting_deploy` |
| Restart without rebuild | `hosting_nodejs_restart-application` (picks up runtime env changes) |
| Runtime logs | `hosting_nodejs_runtime-logs` (only `console.*` output is captured — raw child-process stdio is not) |
| New migration | run `npm run db:migrate` from a workstation with the Neon `DATABASE_URL`, **before** pushing code that needs it |
| Reset demo data | `NODE_ENV=development node apps/api/dist/seed/seed.js --reset` against Neon (wipes everything) |
| Build logs / failure analysis | `hosting_get-deployment` with the domain |
| Rotate a secret | change it in Neon/Upstash or generate a new one → replace the full env set → restart (rebuild if build-time) |

## Deviations from the production plan (accepted for the demo only)

| Production rule | Demo | Consequence |
|---|---|---|
| `NODE_ENV=production` on the API (enforces `productionProblems()`) | API child runs `NODE_ENV=development` (`API_NODE_ENV`) | session cookie lacks the `Secure` flag (site is still HTTPS-only); no production config gate |
| Two portals on two Node.js sites | two host names on one process (enforced) | a crash or deploy affects both portals at once |
| `MFA_ENFORCE=true` | off | seeded staff sign in with password only |
| Separate always-on worker host | workers inside the API child (`RUN_WORKERS=true`) | if Hostinger idles/restarts the process, timers pause until the next request wakes it |
| PITR backups, monitoring | Neon free-tier history only; no alerting | not suitable for real candidates |
| Real mail | `SMTP_HOST` unset → mail stays in the DB outbox | password-reset codes are not delivered |

Free-tier limits to watch: Upstash 500k commands/month (BullMQ polling consumes some continuously); Neon free compute auto-suspends when idle,
so the first request after a quiet period is slower.

## Redis from Hostinger (intermittent)

Right after the first deploys every Redis connection to Upstash ended in `ECONNRESET` and `/api/health` reported `degraded`; about
20 minutes later it reported `{"status":"ok","db":true,"redis":true}` with no change on our side. So outbound 6379 is **not** blocked —
the resets were transient (the Upstash database is in Singapore, the web server in Boston). If `redis:false` returns, the API degrades:

| Keeps working | Needs Redis |
|---|---|
| sign-in, dashboards, question bank, papers, scheduling, sitting an exam, answer saves, submit | password-reset codes (`rt:*`), student self-registration (`reg:*`) |
| grading (database sweeper recovers when the queue is down) | login rate limiting |
| live monitor (falls back to polling) | live push (SSE) via Redis pub/sub |

Improve it by recreating the Upstash database in `us-east-1` (free tier allows one database: delete the Singapore one first), or remove
the dependency (PR #3, after porting the exam-control services).

## Lessons (things that cost time)

- **Loopback ports between processes don't work on Hostinger web hosting.** A child API on `127.0.0.1:<port>` reported `EADDRINUSE`
  while the parent got `ECONNREFUSED` — the host's process layer owns `listen()`. Serve everything from the one process on `PORT`.
- **Hostinger's runtime log only records `console.*`.** Child output written with `stdio: 'inherit'` vanished; forward it via `console`.
- **Remote PostgreSQL needs longer transaction timeouts** (Prisma `P2028` at 5 s). Seeding over the internet takes many minutes.
- **Put the database next to the web server.** The Hostinger server is in Boston; Neon/Upstash were first created in Singapore,
  adding ~230 ms to every query and making the Redis health ping (500 ms command timeout) flap. Check the server in the runtime log
  (`lifecycle reconciler started on us-bos-…`) before choosing regions.
- **The account is near its Node.js site limit** (10 slots); this demo uses the last one.
- **Login lockout:** 5 failed sign-ins lock an account for 15 min. A failed attempt while the API was down returns 500 and does not count,
  but repeated wrong passwords do — if locked, wait 15 min or re-run the seed.

## Never

- Commit `.env` files or connection strings. They are in Hostinger env vars only.
- Use this database for real students/staff, or copy it into a production database.
- Point a production domain at this site without first closing the blockers in `../hostinger-managed/release-blockers.md`.

## Repository state at deployment (2026-11-01)

`main` contains PRs #1, #4–#7 plus the integration merge of `claude/oes-platform-foundation` (UI/UX batches), `claude/frontend-hardening`
(PR #2), `claude/hosting-hostinger-plan` and `claude/ci-baseline-foundation`. Conflicts in `apps/web/src/app/(app)/layout.tsx` (notification
menu: accessible disclosure from #2 + icon button / unread filter from foundation) and `apps/web/src/app/(app)/exams/page.tsx` (typed DTOs
from #2 + URL state / required markers from foundation) were resolved by keeping both sides.

**Not merged: PR #3 `claude/hosting-stage1-no-redis`.** It removes Redis/BullMQ but predates the exam-control backend now on `main`, whose
event channel, live monitor, control service and student registration use Redis (`modules/control/events.service.ts`, `monitor.service.ts`,
`control.service.ts`, `auth/registration.service.ts`). Merging needs those ported to the database-backed design first (hosting track, see
`docs/COORDINATION.md`); a mechanical conflict resolution would break live exam control.
