# Hostinger demo deployment (live) — what, why, how

> **This is a seeded DEMO, not production.** All accounts are synthetic (`@demo.szabmu.invalid`, password `Demo-Passw0rd-2026!`).
> Production rules (two portals, MFA, `NODE_ENV=production` on the API) are deliberately **not** active here — see "Deviations from the production plan".
> For the real production plan read [`../hostinger-managed/`](../hostinger-managed/) and its `release-blockers.md`.

## At a glance

| Item | Value |
|---|---|
| Live URL | https://yellowgreen-grasshopper-337716.hostingersite.com (free Hostinger subdomain) |
| Health check | `GET /api/health` → `{"status":"ok","db":true,"redis":true}` |
| Hosting | Hostinger Cloud Enterprise (order `1009002313`, hPanel user `u943531942`), **one** managed Node.js website |
| Node.js | 24 (highest Hostinger offers; CI job `node24` is green for build/typecheck/lint/tests) |
| Source | GitHub `romi-alt/SZABMU-OES`, branch `main` — Hostinger Git auto-deploy rebuilds on every push |
| PostgreSQL | **Neon** free tier, project `szabmu-oes` (`empty-voice-15975689`), PG 16, region `aws-ap-southeast-1` (Singapore), org of the account that owns the "Elevariq" project |
| Redis | **Upstash** free tier, database `szabmu-oes`, AWS `ap-southeast-1` (Singapore), TLS (`rediss://`) — 500k commands/month, 10k/s |
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

1. **Neon** (console, signed-in browser): created project `szabmu-oes`, PG 16, `aws-ap-southeast-1`. Copied the owner connection string (`sslmode=require`).
2. **Upstash** (console): created Redis `szabmu-oes`, Free plan, AWS Singapore. Used the TCP `rediss://default:<token>@<host>:6379` URL.
3. **Schema + demo data**, from a workstation (never from the Hostinger build — see `../hostinger-managed/04-database-requirements.md` D10):
   ```bash
   export DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' REDIS_URL='rediss://…upstash.io:6379'
   npm run build:api
   npm run db:migrate
   NODE_ENV=development node apps/api/dist/seed/seed.js --reset   # SYNTHETIC data; slow over the internet (minutes)
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
   | `WEB_ORIGIN` | `https://yellowgreen-grasshopper-337716.hostingersite.com` |
   | `TRUST_PROXY` | `true` (behind Hostinger's edge) |
   | `DEV_EXPOSE_CODES` | `false` |
   | `RUN_WORKERS` | `true` (BullMQ consumers + lifecycle reconciler run inside the API child) |
   | `PORTAL_ENFORCE`, `MFA_ENFORCE` | `false` (demo) |

6. **Deploy:** `hosting_deploy` with `git: { repository: "romi-alt/SZABMU-OES", branch: "main" }`, `type: nodejs`, Node 24,
   app type `other`, root `.`, build script `build`, entry file `scripts/hostinger-single-site.mjs`. Auto-deploy is on: every push to `main` rebuilds.
   Poll `hosting_get-deployment` until the build is `completed` or `failed`.
7. **Verify:** `curl https://<domain>/api/health` and sign in as `student.a002@demo.szabmu.invalid` / `cce@demo.szabmu.invalid`.

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
| Two portals (`oes.` students / `dashboard.` staff), `PORTAL_ENFORCE=true` | one site, every role | students and staff share one origin |
| `MFA_ENFORCE=true` | off | seeded staff sign in with password only |
| Separate always-on worker host | workers inside the API child (`RUN_WORKERS=true`) | if Hostinger idles/restarts the process, timers pause until the next request wakes it |
| PITR backups, monitoring | Neon free-tier history only; no alerting | not suitable for real candidates |
| Real mail | `SMTP_HOST` unset → mail stays in the DB outbox | password-reset codes are not delivered |

Free-tier limits to watch: Upstash 500k commands/month (BullMQ polling consumes some continuously); Neon free compute auto-suspends when idle,
so the first request after a quiet period is slower.

## Lessons (things that cost time)

- **Loopback ports between processes don't work on Hostinger web hosting.** A child API on `127.0.0.1:<port>` reported `EADDRINUSE`
  while the parent got `ECONNREFUSED` — the host's process layer owns `listen()`. Serve everything from the one process on `PORT`.
- **Hostinger's runtime log only records `console.*`.** Child output written with `stdio: 'inherit'` vanished; forward it via `console`.
- **Remote PostgreSQL needs longer transaction timeouts** (Prisma `P2028` at 5 s). Seeding over the internet takes many minutes.
- **The account is near its Node.js site limit** (10 slots); this demo uses the last one.
- **Login lockout:** 5 failed sign-ins lock an account for 15 min. A failed attempt while the API was down returns 500 and does not count,
  but repeated wrong passwords do — if locked, wait 15 min or re-run the seed.

## Never

- Commit `.env` files or connection strings. They are in Hostinger env vars only.
- Use this database for real students/staff, or copy it into a production database.
- Point a production domain at this site without first closing the blockers in `../hostinger-managed/release-blockers.md`.
