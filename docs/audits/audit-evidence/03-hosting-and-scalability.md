> Evidence file for `docs/audits/SZABMU-OES-INFRASTRUCTURE-AND-AI-READINESS-AUDIT.md` (2026-11-07). Produced by static, read-only code review; nothing was executed. Each finding is tagged VERIFIED (code read at the cited line) or ASSUMPTION. Findings in the main report marked "re-checked" were additionally confirmed by the lead auditor.

# SZABMU OES - Hosting, deployment, scalability and reliability audit

Reviewer area: HOSTING / DEPLOYMENT / SCALABILITY / RELIABILITY. Read-only. Nothing was run, started, deployed or queried live. No secrets printed (a local `.env` exists at the repo root and was not opened).
Tags: **VERIFIED** = read in code/config/CI at the cited line. **ASSUMPTION** = depends on a Hostinger platform fact or measurement that the repository claims but this audit could not confirm.
Paths are relative to `/home/user/SZABMU-OES`.

## 0. Summary

The software layer is unusually careful about correctness (database clock, revisioned saves, seal-once, DB-leased reconciler, outbox, Redis-optional coordination). The weaknesses are not in answer durability; they are in (a) a single-process topology with no capacity evidence on the real host, (b) deploy/ops hygiene (auto-deploy to the live domain with no gate, production safety gate bypassed, no scheduled backups, no alerting), and (c) several global serialisation points that will bite on exam-day bursts (login/audit lock, start burst, SSE-triggered heartbeat stampede, campus NAT rate limit). The repository's own docs say the same about capacity ("INTERNAL_TESTING_READY", `docs/deployment/PRODUCTION_READINESS_CHECKLIST.md:3`); this audit confirms that from code and adds the items below. Large parts of the older docs describe an architecture that no longer exists (PostgreSQL/pg/Redis/BullMQ/external worker) and would mislead an operator (OPS-20).

Counts: CRITICAL 2, HIGH 9, MEDIUM 9, LOW 4, INFORMATIONAL 2 (26 findings).

---

## 1. Runtime topology (as built)

| Aspect | What the code does | Evidence |
|---|---|---|
| Entry point | Hostinger runs `scripts/hostinger-single-site.mjs` (npm `start:hostinger`) | `package.json:30`; `scripts/hostinger-single-site.mjs:1-15`; demo README "Deploy" step 6 (entry file) |
| Node processes | **One** long-lived Node process (web + API + background loops). One transient child at every start: `prisma migrate deploy` via blocking `execFileSync` (timeout 120 s) | `hostinger-single-site.mjs:81`; `auto-migrate.mjs:119` |
| Ports | One `http.createServer` on `process.env.PORT` (fallback 3000). No second port; loopback child ports were found unusable on Hostinger (`EADDRINUSE` but refused) | `hostinger-single-site.mjs:24,85-86`; demo README "Lessons" |
| Routing | `/api` and `/api/*` -> NestJS Fastify instance via `fastify.routing(req,res)` in-process; everything else -> Next.js request handler (`next({dev:false})`). Next `rewrites` and `API_INTERNAL_URL` are therefore unused on Hostinger | `hostinger-single-site.mjs:26-45,85`; `apps/web/next.config.mjs:4` |
| Portals | Host header -> `X-OES-Portal` via `PORTAL_HOSTS`, overwritten per request; `PORTAL_FROM_HEADER` set | `hostinger-single-site.mjs:52-61,83` |
| Event loop sharing | Next SSR/asset serving, NestJS request handling, argon2 callbacks, SSE writes, the 5 s lifecycle timer, 1 s SSE tick, 15 s outbox sweep and the in-process job runner all run on the **same** event loop | `lifecycle.service.ts:43-49`; `events.service.ts:150-153`; `jobs.service.ts:26-36`; `queues.service.ts:19-46` |
| Background work | No worker process. With `REDIS_URL` unset: `LocalQueues` (in-process, 5 attempts, lost on restart); `LifecycleService` timer every 5 s (`LIFECYCLE_INTERVAL_MS`) taking a DB lease (`lifecycle_leases`, 15 s); outbox sweep every 15 s; KV expiry sweep every 60 s | `queues.service.ts:11-17,76`; `lifecycle.service.ts:19-20,45-48,53-59`; `jobs.service.ts:9-10,30-34`; `kv.service.ts:48` |
| What replaced Redis/BullMQ | `kv_entries` (rate limits, codes, session/paper caches, sets) and `attempt_heartbeats` tables; in-process pub/sub plus 2 s DB catch-up poll for events; in-process queue with DB backstops (grade backstop in lifecycle, mail outbox retry) | `kv.service.ts:8-29,47-49,80-92`; `events.service.ts:73-74,160`; `lifecycle.service.ts:235-236` |
| Finite cron backstop | `npm run reconcile` (`cron/reconcile.ts`) exists but **is not scheduled** on this deployment | `cron/reconcile.ts:8-17`; `HOSTINGER_DEPLOYMENT_AUDIT.md` table row "Cron ... not used by this deployment" |
| DB | Hostinger MariaDB 11.8, same server. App uses pool `DB_POOL_MAX` (default 20), `minimumIdle` 2, `idleTimeout` 240 s, text protocol, session init `time_zone=+00:00`, `ANSI_QUOTES`, strict mode. README says host is `<hostinger-db-host>:3306` with `sslaccept=strict` | `config.ts:15`; `prisma.service.ts:14`; `db-url.ts:11-13,36-40`; demo README at-a-glance table |
| Real-time | SSE per candidate (`/me/exams/:id/stream`) and per staff viewer; caps 4 per user, 20 000 per process (env-tunable); keep-alive every 15 s; `retry: 3000` | `control.controller.ts:26,81-83,92-102,117` |
| Client load per candidate | heartbeat every 15 s; notification bell poll every 30 s for every signed-in user; lobby poll every 10 s; control/monitor pages poll every 8 s when SSE is down | `packages/shared/src/constants.ts:18`; `apps/web/src/exam-engine.ts:63`; `apps/web/src/app/(app)/layout.tsx:19`; `app/exam/[examId]/page.tsx:67`; `monitor/[examId]/page.tsx:21` |
| File/object storage | None. S3 settings exist in config but no S3 client use in `apps/api/src` outside config; student/teacher photos are stored as `BYTES` in MariaDB; no upload pipeline | `config.ts:19-23`; grep of `apps/api/src` (no `S3Client`); `schema.prisma:545,1249` |
| Mail | Outbox row in DB first, then in-process delivery; authenticated SMTP to a Hostinger mailbox; new transport per message | `mail.service.ts:35-36,59-60,73`; demo README deviations table |
| Secrets | Hostinger hPanel env vars (full-replace, masked on read); none in git (`.gitignore:5-6,15-17`) | `.gitignore`; `HOSTINGER_DEPLOYMENT_AUDIT.md` table; `hostinger-managed/09-platform-limitations.md` L11 |
| Deploy | Hostinger Git auto-deploy from `main` of `romi-alt/SZABMU-OES`, build script `build`, restart; migrations run inside the launcher before the server listens | demo README "Deploy" step 6; `hostinger-single-site.mjs:81` |
| Memory/CPU limits assumed | **None known.** Repo says "CPU/RAM share unknown" | `HOSTINGER_DEPLOYMENT_AUDIT.md` table row "CPU/RAM share"; `release-blockers.md` B-09 |

## 2. Hosting constraints and what is / isn't available

Platform facts below are quoted from repo docs (labelled in those docs as `[repo]`, `[live]` or `[unverified]`) and were not re-confirmed against Hostinger by this audit (ASSUMPTION unless stated).

| Item | Status |
|---|---|
| Plan | Hostinger Cloud Enterprise, managed Node.js site; no root, no Docker, no VPS. |
| Node versions | 18/20/22/24; production runs 24. `engines` `>=24` (`package.json:9`). |
| Processes | One per site; ~10 Node sites per account, 9 used (unverified count); production 3-site plan does not fit. |
| Redis | Not available (optional Upstash was used then dropped). Code supports absence. |
| Persistent background workers | Not available; reconciler lives in the web process and can pause if the host idles or restarts it (documented, unverified). |
| Cron | Exists on plan, minimum interval and Node support unverified; not configured. |
| Request limit | 120 s per request at the edge (unverified) - affects SSE and long requests. |
| Database | MariaDB 11.8; 150 connections, **500 new connections/hour/user**, idle closed at 300 s, statements capped at 300 s (all `[repo]`). No binlog/PITR on shared MariaDB (backup-restore.md "Gaps"). |
| Logs | Only runtime console output is retained (`demo README` "Lessons"); retention unknown. |
| Metrics scraping | No Prometheus on the plan; needs an external service. |
| Object storage | None on plan; the app does not currently need it (photos in DB). |
| Multiple API processes | Not possible on this plan; code is multi-process-safe where it matters (DB lease, row claims, DB KV) but per-process caches exist (OPS-17). |

---

## 3. Findings

### OPS-01 - CRITICAL - Capacity on the real host is unmeasured; the single process is the ceiling for a stated 20 000-candidate target
- Where: `scripts/hostinger-single-site.mjs:80-90`; `docs/architecture.md:3-5` (target 20 000 simultaneous); `docs/audits/IMPLEMENTATION_TRACKER.md` section 2 and 2b; `docs/deployment/PRODUCTION_READINESS_CHECKLIST.md:A3,B1` (both unchecked); `release-blockers.md` B-09.
- Evidence: All measurements are on a 4 vCPU / 15 GB machine running API + MariaDB + load generator together, MariaDB on localhost, no TLS to DB, no Next/SSR traffic through the same process, no student SSE, no real login. Best result: 5 000 candidates at ~20 s/question with starts over 60 s, host CPU 27 % mean. A 5 000-candidate start inside 10 s gave start p50 10.8 s and save p99 1.8 s (tracker 2b). The doc itself says "No capacity claim for Hostinger follows from this".
- Impact: Nothing in the repository supports running a real multi-campus exam on this plan. The "20 000 simultaneous" design goal is unsupported; even 5 000 depends on staggered starts.
- Recommendation: Run the proposed plan in section 6 against a staging copy on the same Hostinger plan and DB before any real candidate. Until then cap cohort per exam window and stagger starts per campus. Decide on option 3 of the deployment audit (API off-Hostinger on a managed container platform, web portals stay on Hostinger) if section 6 targets are missed.
- Tag: VERIFIED (absence of evidence and local-only data); host ceiling ASSUMPTION.

### OPS-02 - CRITICAL - Every push to `main` redeploys and restarts the only production process; no CI gate, no live-exam guard, migrations run inside the serving process
- Where: demo README step 6 ("Auto-deploy is on: every push to `main` rebuilds"); `ROLLBACK_AND_RECOVERY.md:1.4` ("auto-deploy restarts the only process"); `hostinger-single-site.mjs:81`; `.github/workflows/ci.yml` (no deploy job, no required-check configuration in the repo); `auto-migrate.mjs:119`.
- Evidence: The only protection against deploying during a LIVE exam is a sentence in a runbook. Hostinger builds from Git independent of GitHub Actions results (CI is not wired to deploy; `ci.yml` has no deployment step). Branch protection/required status checks cannot be seen from the repo. On restart: blocking `execFileSync` Prisma migration (up to 120 s) plus `next.prepare()` before `listen`, so the site returns edge errors during that window. SSE connections drop, in-process queued jobs vanish (`queues.service.ts:14-17`).
- Impact: A merge by any contributor/bot during an exam interrupts all candidates' saves/streams and can apply schema changes live. A failed or slow migration is swallowed (`auto-migrate.mjs:123-127`) and the app starts on an older schema ("never fatal"), which can fail at runtime instead of at deploy.
- Recommendation: (1) Branch-protect `main` with required CI (verify + node24); (2) deploy from a dedicated `release` branch/tag that is promoted by a human, not `main`; (3) add a start-up guard that refuses to run migrations or (via the control state) warns when an exam is LIVE/SUSPENDED, and an operator "deploy freeze" flag in the DB checked by the launcher; (4) run migrations as a separate, observable step (CI manual job or workstation) and keep `AUTO_MIGRATE=false` in production; (5) publish a deploy calendar tied to the exam calendar.
- Tag: VERIFIED (code and docs); branch-protection state ASSUMPTION.

### OPS-03 - HIGH - The production safety gate (`productionProblems`) is bypassed on the live deployment
- Where: `hostinger-single-site.mjs:12,27`; `config.ts:59-88,92-95`; checklist A4/A5/A7 unchecked.
- Evidence: The API is created with `NODE_ENV=development` (`API_NODE_ENV` default) specifically to avoid `PORTAL_ENFORCE`/`MFA_ENFORCE` demands; `NODE_ENV` is flipped to production only afterwards for Next. `loadConfig()` only runs the gate when `NODE_ENV==='production'`. Consequently these are NOT enforced: weak-secret checks, `METRICS_TOKEN` required, TLS-to-DB required (`sslaccept`), `TRUST_PROXY` set, MFA, `SESSION_TTL_HOURS<=24`, login-rate defaults. Session cookie `Secure` is derived separately (`auth.ts:34-37`) so that part is covered.
- Impact: A mis-set environment variable (the hPanel env set is full-replace, masked on read) will boot silently instead of refusing.
- Recommendation: Add a launcher-level production mode (e.g. `OES_ENV=production`) that runs `productionProblems()` regardless of `NODE_ENV`; keep a separate explicit `DEMO_MODE=true` to relax individual rules, with each relaxation logged at start.
- Tag: VERIFIED.

### OPS-04 - HIGH - Background state progression depends on traffic and process lifetime; the cron backstop is not configured
- Where: `lifecycle.service.ts:43-49` (unref'd interval), `kv.service.ts:48`, `jobs.service.ts:33`; `cron/reconcile.ts`; `HOSTINGER_DEPLOYMENT_AUDIT.md` ("timers pause if the process is idled/restarted until the next request"); `deadline-safety.md` "Where the reliance on a runner remains".
- Evidence: Reconciler loop `loop()` runs at boot and every 5 s while the process lives; the timer is `unref()`. If Hostinger idles/recycles the process, nothing runs until a request wakes it. Abandoned attempts (closed laptop) stay IN_PROGRESS until something finalizes them. AUTOMATIC exam open/close, scoring start, absentee marking, result readiness and mail outbox retries all ride on it. Deadline enforcement itself does NOT: the save predicate checks `deadlineAt + SAVE_GRACE_SECONDS > NOW(3)` in SQL (`delivery.service.ts:243-251`), and start/heartbeat finalize lazily (`delivery.service.ts:134-137,293-298`).
- Impact: Correctness is preserved (good), but result release, grading, receipts for abandoned candidates and "exam closed" status can lag unboundedly in quiet periods. Documentation promises "≤ ~10 s" which holds only while the process is alive.
- Recommendation: Create the Hostinger cron job for `npm run reconcile` every minute (verify it supports Node and the interval); add an external uptime ping every 1-2 minutes to `/api/health` so the process is woken and the lifecycle loop keeps running; expose lifecycle staleness in health (OPS-11).
- Tag: process-recycling behaviour ASSUMPTION (documented, unverified); code behaviour VERIFIED.

### OPS-05 - HIGH - Every login (success and failure) takes a global exclusive lock; plus argon2 CPU; login bursts will serialise
- Where: `audit.service.ts:45-48` (`SELECT ... FROM app_locks WHERE name='audit_chain' FOR UPDATE` then `findFirst ORDER BY seq DESC`, then insert); `auth.service.ts:57,64,80` (audit on failed login, wrong portal, success); `auth.service.ts:50` (argon2 verify; also a dummy verify on unknown users `:46,50`). Submits deliberately avoid the chain (`delivery.service.ts:~398-400`, comment "globally serialised audit chain").
- Evidence: One audit transaction is BEGIN + lock + select + insert + COMMIT (about 5 round trips) while holding a lock shared by all logins, logouts, registrations, password resets and every staff action. argon2 runs on the libuv threadpool (default 4 threads), memory-hard per verify.
- Impact (estimate, see section 5): login throughput is bounded by `1 / (audit tx duration)`, likely tens to low hundreds per second locally and fewer with a TLS network hop; 5 000 candidates logging in within a minute before an exam would queue; failed-login floods (credential stuffing) also serialise genuine logins.
- Recommendation: Do not put per-login events on the global hash chain; write them to a per-row (non-chained) `auth_events` table or sharded chains per day/institution and anchor periodically; tune argon2 cost and thread pool (`UV_THREADPOOL_SIZE`) after measuring; add login ramp guidance (open login window 30-60 min early). Keep exam-critical staff commands on the chain.
- Tag: lock/serialisation VERIFIED; throughput numbers ASSUMPTION.

### OPS-06 - HIGH - Per-IP login limit (60 / 15 min) with campus NAT, and TRUST_PROXY semantics unresolved
- Where: `config.ts:44-47,79,36-39`; `auth.service.ts:39-41`; `release-blockers.md` B-06, B-13; `HOSTINGER_DEPLOYMENT_AUDIT.md` row "Correct client IP ... Not met (SEC-08)".
- Evidence: The limit is fixed at 60 per IP per 15 min in production (config refuses other values) and counted per `req.ip`. With `TRUST_PROXY=true` (demo setting) the left-most `X-Forwarded-For` is client-controlled, so the limit is bypassable; with an exact hop count it would instead lock out a whole lab/campus that shares one NAT address after 60 logins.
- Impact: Either security control is ineffective, or legitimate candidates in a computer lab are rejected with 429 minutes before an exam. Both are exam-day failure modes.
- Recommendation: Measure the real hop count behind Hostinger's edge, set numeric `TRUST_PROXY`; replace the single fixed IP limit by (a) per-account limits (kept) and (b) a larger, per-institution-aware IP allowance (allow-list of campus egress IPs maintained per institution) instead of one global 60.
- Tag: VERIFIED (code); hop count ASSUMPTION.

### OPS-07 - HIGH - Start burst and SSE-triggered heartbeat stampede
- Where: `tracker 2b` (start ~200/s per process; 5 000 within 10 s -> p50 10.8 s); `apps/web/src/app/exam/[examId]/page.tsx:140` (every non-`state` SSE event makes every client call `engine.heartbeat()` immediately); `events.service.ts:131-139` (broadcast to all subscribers of the exam); `control.service.ts:63,334` (nudges on commands); `delivery.service.ts:282-299` (heartbeat = 1 read join + 1 upsert + session lookup).
- Evidence: A single EXAM_STARTED / extension / suspend / resume event fans out to N SSE clients, all of which immediately issue a heartbeat. There is no client jitter. A synchronized start of N candidates therefore produces N logins/starts followed by N near-simultaneous heartbeats on every control command. The start path itself is the measured bottleneck (~31 % idle on DB wait, ~35 % in the DB driver).
- Impact: Each control action during a large live exam creates a latency spike on the single event loop, exactly when invigilators are acting on an incident.
- Recommendation: Add random client-side jitter (0-5 s, scaled by exam size) before the SSE-triggered heartbeat, but keep an immediate heartbeat when the event itself says time changed for that candidate (extension/suspend scoped to that candidate). Use INDIVIDUAL timing with per-campus staggered admission. Server: coalesce per-attempt heartbeats within 1-2 s.
- Tag: VERIFIED (code path); magnitude ASSUMPTION.

### OPS-08 - HIGH - Backup is not automated, never exercised against production, and restore to Hostinger has never been rehearsed
- Where: `docs/operations/backup-restore.md` ("Gaps": not scheduled, not shipped off-site, retention not enforced, no encryption, RPO = backup interval); `ROLLBACK_AND_RECOVERY.md:5` and checklist A11, A12 unchecked; `scripts/db-backup.mjs`.
- Evidence: Tool quality is good (consistent snapshot, manifest, fingerprint, verify into a disposable server; `db-backup.mjs:68-96`, test `apps/api/test-fault/backup-restore.test.ts` exists and is a MariaDB test). But: no schedule/cron; no off-site copy; dumps are unencrypted plain SQL containing PII and answer keys; one 10.5 MB demo database was verified locally (35 327 rows), nothing at exam scale; a restore into Hostinger's own MariaDB (grants for triggers, DELIMITER dumps, `phpMyAdmin`/CLI size limits, `mariadb` client availability) was never executed; `verify` needs `mariadb-install-db` binaries unavailable on Hostinger, so verification must run on a workstation that can reach the DB (needs Remote MySQL - see OPS-14). Hostinger "daily backups (hPanel)" retention/restore granularity is unverified. Dumps run as ONE long REPEATABLE READ snapshot across all tables; against a 300 s statement cap and large `answer_events` (OPS-13) a single table SELECT may fail.
- Impact: RPO is whatever the last manual dump was; RTO is unknown. Loss of the shared MariaDB = loss of the examination record (the append-only protections do not help against server loss).
- Recommendation: (1) Scheduled backups from a small external runner (GitHub Actions scheduled job or any external VM/serverless job) to encrypted off-site storage (S3-compatible, `age`/GPG), at least hourly on exam days and nightly otherwise, plus a mandatory pre-open and post-close dump; (2) monthly automated `verify` with the result reported; (3) rehearse restore into a fresh Hostinger database and record elapsed time (RTO); (4) take the dump in table-chunked, resumable form for large tables; (5) consider a managed MySQL/MariaDB with PITR for the system of record if the university requires RPO under minutes.
- Tag: VERIFIED.

### OPS-09 - HIGH - No alerting, no external monitoring, and the shipped alert pack misses the failures this topology actually has
- Where: `infra/observability/alerts.yml` (16 rules, no rule mentions `lifecycle`; verified 0 matches); `docs/operations/observability.md` ("Not provided": Alertmanager, dashboards, uptime probes); `worker-architecture.md` ("Liveness and alerting" promises alert at >30 s on `oes_lifecycle_last_success_age_seconds`); `HOSTINGER_DEPLOYMENT_AUDIT.md` ("no scraper/alerting on this plan"); checklist A13.
- Evidence: The metric exists (`metrics.service.ts:76,77,78`) but no rule uses it; no rule covers outbox backlog; `OESDatabaseDown` summary still says PostgreSQL; rules assume Prometheus which cannot run on the plan. `/api/health` returns ok/degraded from DB + KV ping only (`health.controller.ts:13-17`) and does not report reconciler staleness, so an external uptime monitor would see "ok" while nothing is being sealed or graded. Metrics are in-process memory and reset on restart/deploy.
- Impact: Exam-day failures (pool saturation, reconciler stalled after a restart, event-loop lag, outbox backlog) are noticed only by users.
- Recommendation: Use an external managed service reachable from the internet (UptimeRobot/BetterStack/Grafana Cloud agentless synthetic checks) hitting `/api/health` every 30-60 s from two regions; add a token-protected `/api/health/deep` returning lifecycle age, expired backlog, pool wait count, event-loop lag and outbox oldest age; Grafana Cloud Free/Alloy cannot run on shared hosting, so scrape via the synthetic check or push metrics from a tiny external poller. Add the missing rules (lifecycle age >30 s / >120 s during window, outbox oldest age, expired backlog >0, SSE connections vs cap, pool acquire timeouts). Route to SMS/WhatsApp/phone on-call.
- Tag: VERIFIED.

### OPS-10 - HIGH - Database engine facts that tests assume are not enforced or verified in production (isolation level, TLS endpoint)
- Where: `db-url.ts:11-14` (session init sets only time_zone, ANSI_QUOTES, STRICT_TRANS_TABLES); `ci.yml:30-32,66-68`, `docker-compose.yml` (`--transaction-isolation=READ-COMMITTED`); `docs/audit/current-build-analysis/06-database-integrity.md:12` ("READ COMMITTED snapshot semantics"); `harness.ts:3` ("READ COMMITTED ... as in production").
- Evidence: The integration, fault and CI environments force READ COMMITTED on the server. The application never sets the isolation level per session, and nothing verifies Hostinger's `@@transaction_isolation`. MariaDB's default is REPEATABLE READ. Some code is written with READ COMMITTED semantics in mind (submit reads answers in a separate statement after a row lock; `LOCK IN SHARE MODE` + `FOR UPDATE` in the save path, `delivery.service.ts:243-255`). The DB host in docs is the public `<hostinger-db-host>:3306` with TLS verification, whereas Hostinger's connector guidance says deployed apps should use `127.0.0.1:3306` (a certificate with that name cannot pass `sslaccept=strict`, and production config requires strict TLS, `config.ts:74`).
- Impact: Gap-lock/deadlock behaviour and phantom/stale-read behaviour on Hostinger can differ from everything tested; `retryOnDeadlock` (3 tries) would hide this until a burst. The public-hostname path may add network hops and TLS cost per round trip (6+ per save); each "new connection" also pays a TLS handshake against the 500/hour limit.
- Recommendation: Add `SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED` to `SESSION_INIT_SQL` (and assert at start with a log line of `@@transaction_isolation`, `@@max_connections`, `@@wait_timeout`, `@@max_user_connections`); expose these in the deep health check; measure per-statement RTT from the deployed process to both endpoints (127.0.0.1 vs srv host) and pick deliberately.
- Tag: ASSUMPTION (production values unverified); code facts VERIFIED.

### OPS-11 - HIGH - SSE through Hostinger's edge is untested; fallback exists but its load is unmodelled
- Where: `control.controller.ts:92-117`; `release-blockers.md` B-11; `hostinger-managed/09-platform-limitations.md` L4; `exam page.tsx:140`.
- Evidence: Streams are held open per candidate with 15 s keep-alives and `retry: 3000`. If the edge cuts at 120 s or buffers responses, N candidates reconnect every ~120 s; each reconnect runs `studentViewer` (1 query), session lookup, `latestId`/`replay` (1-2), `stateOf` (>=1). The heartbeat (15 s) is the safety net so correctness holds. `X-Accel-Buffering: no` only helps nginx-type proxies; whether Hostinger's CDN/ALIAS layer streams is unknown.
- Impact (estimate): 5 000 candidates -> ~40 reconnects/s -> ~200 extra DB queries/s as baseline churn, plus the SSE connections consume sockets/memory on the one process; if buffered, push delivery silently degrades to 15 s polling (EXAM_STARTED up to 10 s late in the lobby).
- Recommendation: Test A-3 from `10-staging-test-plan.md` on the real plan; if streaming works, still cap server-side stream life to ~100 s with a graceful `resync` so reconnects are server-driven and staggered by jitter; if not, disable SSE for candidates (keep only for staff), rely on heartbeat piggy-backed state, and raise the poll to 20-30 s for large exams.
- Tag: ASSUMPTION (platform behaviour); code VERIFIED.

### OPS-12 - MEDIUM - CI does not cover the deployed topology or the reliability tooling
- Where: `.github/workflows/ci.yml` (all 75 lines); `playwright.config.ts:16-22`; grep of `tests/`, `apps/*/test*` for `hostinger-single-site|auto-migrate|stampPortal` returned nothing.
- Evidence: `verify` job (Node 26 + Redis) runs typecheck, lint, vitest, build and Playwright e2e; `node24` job (the production runtime, no Redis) runs everything except e2e. E2E starts separate API (`main.js`) and Next processes, never the single-process launcher, never database-KV mode. The fault-injection suite (`npm run test:fault`), backup verify, load test, `auto-migrate`, launcher, portal stamping and redirect logic are not run in CI. No dependency audit, SAST, container/secret scan, migration safety check, or deploy workflow. The Dockerfiles use `node:26-slim` (`infra/Dockerfile.api:1`) whereas Hostinger runs Node 24.
- Impact: The exact artefact that serves candidates (launcher + Node 24 + no Redis + single process) has no automated test; regressions in the launcher or migration step are first seen on the live domain.
- Recommendation: Add a CI job that builds, starts `scripts/hostinger-single-site.mjs` on Node 24 with no `REDIS_URL` and runs Playwright smoke + a 200-candidate `exam-load` plus `/api/health`; add a scheduled nightly job for `test:fault`, `backup:db` + `backup:verify`, `npm audit --omit=dev`, and a migration-lint step (fail on DROP/RENAME unless annotated); align Docker base image with Node 24.
- Tag: VERIFIED.

### OPS-13 - MEDIUM - Unbounded growth of `answer_events`, plus append-only triggers prevent pruning; storage plan limit unknown
- Where: `delivery.service.ts:~252` (one `answer_events` insert per accepted save); `schema.prisma:840-852`; `db-backup.mjs:26-27` (triggers `answer_events_no_update/delete`); `observability.md` ("partitioning is not implemented").
- Evidence: 1 row per save (about 1.15 per question). A 5 000-candidate x 100-question exam is ~575 k rows; 50 exam sittings per term is ~29 M rows; no delete is permitted by trigger, no archival path, and backups copy it in one snapshot. Disk quota of the Hostinger plan not stated anywhere in the repo.
- Impact: Backup duration/size, restore RTO and disk exhaustion grow with every exam; hard to remediate later because of the triggers.
- Recommendation: Define a retention/archival policy now: after the result is published and the appeal window closes, export per-exam answer-event files to cold storage and replace the table by monthly range partitions (MariaDB supports `PARTITION BY RANGE` on `at`); document the trigger bypass procedure for the archival role. Monitor DB size in the deep health check.
- Tag: row growth VERIFIED; disk limits ASSUMPTION.

### OPS-14 - MEDIUM - Remote MySQL is open to `%` for workstation maintenance (documented)
- Where: demo README "How it was done" step 1 ("Remote MySQL allows `%` so the workstation can migrate it"); `db-backup.mjs`, `scripts/pg-to-mysql.mjs` rely on remote access.
- Evidence: The database user used by the application is also the one opened to the internet (same `DATABASE_URL`); only password + TLS protect it. Still applicable if not revoked after seeding (current state not verifiable from the repo).
- Impact: A leaked password allows direct SQL, bypassing every application control (the append-only triggers limit but do not remove risk).
- Recommendation: Replace `%` with the specific egress IPs of the backup runner/operator (Hostinger Remote MySQL accepts IP entries), or use a separate low-privilege read-only backup user; rotate the DB password after any maintenance window.
- Tag: ASSUMPTION (current state).

### OPS-15 - MEDIUM - Database round-trip and connection budget per request is high for a remote or TLS endpoint, and every authenticated request pays a KV query
- Where: `auth.ts:56-80` (session cache via `kv.getJson` = one `SELECT ... FROM kv_entries` per request on the database backend; miss = join + 2 upserts); `delivery.service.ts:241-258` (save = BEGIN, share-lock SELECT, FOR UPDATE SELECT, UPDATE/INSERT, INSERT answer_events, COMMIT); `kv.service.ts:96-100`; `db-url.ts:36-40`; `config.ts:15-18`.
- Evidence: One answer save is ~7 DB round trips (1 KV + 6 transaction). Heartbeat is ~3 (KV + join + upsert). Pool default 20 for the single process; Hostinger limits 150 total / 500 new per hour. Worst-case reconnect churn with pool 20 and `idleTimeout` 240 s: 20 x 15 cycles = 300 new connections/hour if load repeatedly bursts and idles; a second process (the finite cron every minute, `autoMigrate` child, a workstation script) uses the same per-user quota. Pool timeout on saturation: mariadb `acquireTimeout` default (10 s) is not set explicitly in `db-url.ts`.
- Impact: Latency per save ~ 7 x RTT. At 0.3 ms local RTT this is invisible (measured p50 ~4 ms); at 3-5 ms RTT over TLS to a hostname it is 20-40 ms per save and holds a pooled connection (and an InnoDB share lock on the attempt row) for the whole duration, so 20 connections cap concurrent saves at ~500-1 000/s before queueing; any DB hiccup becomes pool-wide stalls.
- Recommendation: Cache the session in a per-process LRU for 10-30 s (invalidate via the existing `dropUserSessions` and a short TTL; accept that revocation may take up to the TTL, document it); collapse the save path into one `INSERT ... ON DUPLICATE KEY UPDATE ... WHERE revision < ?` statement guarded by a join on attempt state (single autocommit statement, no explicit transaction); set `acquireTimeout` and `connectionLimit` explicitly and log pool wait; keep `DB_POOL_MAX<=25` until measured.
- Tag: VERIFIED (round-trip counts); latency numbers ASSUMPTION.

### OPS-16 - MEDIUM - In-request bulk work that can exceed the 120 s edge limit and block the event loop
- Where: `results.service.ts:48-52,100-112` (`keyAction` -> `regradeExam` grades every sealed attempt sequentially inside the HTTP request; each `gradeAttempt` does 3 reads incl. the full `exam_questions` snapshot JSON + a 2-statement transaction, `:19-43`); `reports.service.ts:96,120` (full-result `findMany` per report/CSV); `exams.service.ts:150,163` (roster build and notify for all candidates in one request); `control.service.ts` bulk commands.
- Evidence: For 5 000 sealed attempts at ~30 ms each the request would run ~150 s sequentially (estimate), past the 120 s edge limit, leaving the client with a 504 while the server continues; grading loads the entire question snapshot set per attempt (~hundreds of KB for a 100-question paper), so a regrade moves multi-hundred-MB over the DB link.
- Impact: Key corrections on large exams appear to fail and may be re-submitted; repeated clicks multiply load. Reports and CSVs are fine up to tens of thousands of rows but are unpaginated.
- Recommendation: Make regrade a background job row (`regrade_jobs`) processed by the existing lifecycle pass in bounded batches (reuse `BATCH`/`BUDGET_MS`), cache effective keys per exam inside a pass, and return 202 with progress; stream CSV with cursor pagination.
- Tag: VERIFIED (code); timing ASSUMPTION.

### OPS-17 - MEDIUM - Per-process state that breaks or degrades with more than one API process
- Where: `delivery.controller.ts:28-29` and `rate-window.ts` (save/event abuse guards per process); `delivery.service.ts:47-60` (`localPapers` 10-minute per-process paper cache; safe because the paper is immutable once approved); `monitor.service.ts:30-32` (per-process aggregate cache 1.5 s); `events.service.ts:46` (stream registry), `control.controller.ts:27` (`openStreams`/`perUser` counters); `metrics.service.ts` (counters in memory); `queues.service.ts` (`LocalQueues` jobs).
- Evidence: With Redis absent, event delivery to other processes depends on the 2 s catch-up poll (`events.service.ts:160`); stream caps are per process; job de-duplication is per process; metrics need summing.
- Impact: Moving to two processes later (or Hostinger running two during a deploy overlap) is mostly safe, but stream limits, abuse guards and monitor freshness become per-process; there is currently exactly one process, so no immediate failure.
- Recommendation: Document that scale-out requires the Redis backend or accepting 2 s event latency; add a startup log of `instance` and cap multi-process deployments in the runbook; keep the lease semantics as they are.
- Tag: VERIFIED.

### OPS-18 - MEDIUM - No global rate limiting or request-size/connection protection beyond Hostinger's unknown edge
- Where: `apps/api/package.json` dependencies (no `@fastify/rate-limit`); `bootstrap.ts:45` (2 MB body limit only); `health.controller.ts:13-17` (public, 2 DB queries per call); `metrics.controller.ts` (token only); `kv.service.ts:77-92` (rate-limit counters write to the DB on login/forgot/registration).
- Evidence: Only login, forgot-password and registration paths are rate limited, and by IP (OPS-06). All other authenticated endpoints and the public health endpoint are unthrottled. The rate-limit counters themselves are DB writes (upsert + select per hit), so a flood of login attempts costs more DB work than a no-op (they also trigger the OPS-05 audit lock on every failed login).
- Impact: A single abusive client or misbehaving script can saturate the single event loop and the 20-connection pool for everyone.
- Recommendation: Put a managed WAF/CDN rate limiter in front (Cloudflare free tier on the domain, if DNS can proxy; otherwise Hostinger edge protections - verify) with per-IP rules on `/api/auth/*` and `/api/health`; add a cheap in-process IP token bucket before DB-backed counters; make `/api/health` cache its answer for 2-5 s.
- Tag: VERIFIED (absence); edge protections ASSUMPTION.

### OPS-19 - MEDIUM - Mail delivery limits and design are unverified for registration/reset bursts
- Where: `mail.service.ts:35-36,59-60,73-79`; `HOSTINGER_DEPLOYMENT_AUDIT.md` row "Email delivery ... not verified live"; checklist A8; `release-blockers.md` B-08.
- Evidence: Each mail opens a new SMTP transport/connection; in-process concurrency 4 (`jobs.service.ts:29`); retry sweep 25 messages per 15 s (`:39-42`, `mail.service.ts:73`) with 5 attempts then permanent FAILED; Hostinger mailbox send quotas (per hour/day) are not recorded anywhere. SPF/DKIM/DMARC not verified.
- Impact: Student self-registration verification codes (thousands in a pre-exam week) can hit provider limits and silently stop at 5 attempts; students cannot register or reset.
- Recommendation: Use a transactional provider (Brevo/SES/Postmark/Mailgun) via SMTP with domain authentication; raise `MAIL` concurrency modestly and add a metric for FAILED count and queue age; add an operator "resend" action.
- Tag: ASSUMPTION (provider quotas); code VERIFIED.

### OPS-20 - MEDIUM - Documentation drift: several authoritative-looking docs describe an architecture that is not deployed
- Where: `docs/architecture.md:4,9-17,45-55` (PostgreSQL 16, Redis, BullMQ, `attempt-sweeper`, `clock_timestamp()`, PgBouncer); `docs/deployment/hostinger-managed/*` (02, 04, 05, `database-connectivity.md`, `deadline-safety.md`, `worker-architecture.md`, `failover-and-recovery.md`: PostgreSQL/`pg`/external worker; `deployment/README.md` flags the folder as "Current plan"); `docs/operations/observability.md` (PostgreSQL/Redis wording, "2,000-candidate run"); `docs/operations/backup-restore.md` ("fault suite still drives PostgreSQL clusters ... not been ported" vs `harness.ts:7-8` and the tracker saying it is ported and 17 pass); `infra/observability/alerts.yml:51`; demo README ("API child", `RUN_WORKERS` "BullMQ consumers + lifecycle reconciler run inside the API child", `API_INTERNAL_URL` set "build-time" though unused; "New migration - run from a workstation before pushing" vs the launcher auto-migrating; Neon "-pooler" wording in `auto-migrate.mjs:7-10`); `infra/hostinger/*` VPS templates still in tree.
- Evidence: Mix of superseded and current statements, sometimes within the same file.
- Impact: An operator following `observability.md`/`failover-and-recovery.md` on exam day would look for Redis, PgBouncer, an external worker and PostgreSQL tools that do not exist.
- Recommendation: Add one authoritative `docs/deployment/CURRENT_TOPOLOGY.md` generated from this report's section 1, mark all superseded docs with a banner and move VPS/PostgreSQL material to `docs/archive/`; fix alert annotations.
- Tag: VERIFIED.

### OPS-21 - LOW - `auto-migrate` claims "every migration is additive" but one drops and recreates generated columns; DDL is non-transactional on MariaDB
- Where: `auto-migrate.mjs:6`; `migrations/20261104200000_teacher_registration_and_onboarding/migration.sql:102-103`; `auto-migrate.mjs:119` (120 s timeout kills the CLI).
- Evidence: `DROP INDEX course_assignments_active_uniq` and `DROP COLUMN activeKey` then re-add. A timeout or failure in mid-migration on MariaDB cannot roll back DDL, leaving Prisma's `_prisma_migrations` in a failed state that blocks later `migrate deploy` until resolved manually; the launcher swallows the failure and continues (`:123-127`).
- Impact: A future long ALTER on a large table (e.g. `attempt_answers`/`answer_events` added index) can be killed at 120 s and wedge deployments.
- Recommendation: Run migrations out of band for large tables, with `pt-online-schema-change`-style or `ALGORITHM=INPLACE, LOCK=NONE` DDL; add the migration-lint check from OPS-12; surface `[migrate] FAILED` in `/api/health/deep`.
- Tag: VERIFIED.

### OPS-22 - LOW - Load-test scripts: two of three are stale PostgreSQL scripts; none exercise login, SSE, web SSR or a network DB
- Where: `tests/load/scale-bench.mjs:11,16` (`import pg`, `gen_random_uuid()`, `$1`), `tests/load/control-load.mjs:14` (`import pg`); `exam-load.mjs:7-8,23-26,59` (provisions sessions directly "bypassing argon2 login"; drives only start/save/heartbeat/submit; local DB).
- Evidence: Only `exam-load.mjs` was ported to MariaDB (tracker T-PERF-01). `scale-bench.mjs` and `control-load.mjs` will fail against MariaDB. No script models: concurrent login bursts (OPS-05), student SSE streams (OPS-07/11), notification polling (30 s), dashboards/reports, many simultaneous exams, or the Next.js SSR path. Think-time is 30-60x faster than a human in the first table (flagged in the tracker).
- Impact: The reported capacity is for the exam-taking API only.
- Recommendation: Port the two scripts to `mariadb`; extend the driver per section 6.
- Tag: VERIFIED.

### OPS-23 - LOW - Metrics endpoint protected only by a static bearer token on the public hostname; metrics reset on every deploy
- Where: `metrics.controller.ts:56-66`; `config.ts:50,84` (token only required in production mode, see OPS-03); `bootstrap.ts:58-61`.
- Evidence: Constant-time comparison (good), no IP restriction, no rate limit, endpoint reachable at `https://<domain>/api/metrics`. Labels are privacy-safe (route patterns). The scrape performs DB queries (lifecycle age, outbox, campus connectivity).
- Impact: Low confidentiality risk (aggregate counters) but an authenticated or leaked token yields free DB work per scrape; counters vanish on restart so rate alerts reset.
- Recommendation: Keep token, add per-minute scrape rate limit, rotate token on staff changes; push metrics to an external store from a sidecar poller to survive restarts.
- Tag: VERIFIED.

### OPS-24 - LOW - Logging is console-only with unknown retention; no request IDs or audit of API access logs
- Where: `bootstrap.ts:46` (Nest logger); demo README "Lessons" (only console output reaches the runtime log).
- Evidence: No structured JSON logs, no correlation id, no shipping to an external store; deploy/restart output lost with the log buffer (retention unspecified).
- Impact: Post-incident reconstruction for a disputed exam relies on the database audit chain and attempt events (strong) but not on infrastructure logs.
- Recommendation: Emit JSON logs with a request id and ship them to an external log service via HTTPS batching; keep 90 days.
- Tag: ASSUMPTION (retention); code VERIFIED.

### OPS-25 - INFORMATIONAL - Strengths worth keeping (verified)
- Deadline enforcement, durability and idempotency live in SQL on the database clock, not in workers: `delivery.service.ts:243-251` (save predicate), `:134-137,293-298` (lazy finalize), `transition`/`lifecycle` row claims with `SKIP LOCKED`, DB lease (`lifecycle.service.ts:53-59`), bounded retries (`MAX_ATTEMPT_RETRIES=5`), poison counters surfaced in `health()`.
- The mail outbox and event outbox persist before delivery and have DB backstops (`events.service.ts:53-87`, `mail.service.ts:73-79`).
- DB connection hygiene designed for Hostinger limits: `minimumIdle: 2`, `idleTimeout: 240` below the 300 s server timeout (`db-url.ts:36-40`).
- Backup tool design (consistent snapshot, fingerprints, verify-by-restore) is sound (`db-backup.mjs`).
- Honest self-assessment in the docs (INTERNAL_TESTING_READY, release blockers, "Not rehearsed").
- Tag: VERIFIED.

### OPS-26 - INFORMATIONAL - Dead or unused infra settings to remove to avoid confusion
- Where: `config.ts:19-23` (S3_* never used by the API); `infra/hostinger/*` (VPS templates); `API_INTERNAL_URL`/`API_PORT` env (unused on Hostinger); `docker-compose.yml` MinIO service.
- Impact: Operators may assume object storage backups/artifacts exist.
- Recommendation: Mark as dev-only or delete; if exports/attachments are planned, specify the external object store now.
- Tag: VERIFIED.

(Additional low-confidence observation, folded into OPS-12: the fault tests include a deadlock/pool-error suite but run only manually.)

---

## 4. Single points of failure

| SPOF | Why | Mitigation available on Hostinger + external services |
|---|---|---|
| The single Node process (web + API + reconciler + SSE) | One event loop, one crash/restart/deploy drops everything; cannot add processes on this plan | Keep restart-safe (already); staggered starts; deploy freeze; move API to an external managed container with 2 instances (option 3 in the deployment audit) if section 6 targets fail |
| Hostinger-shared MariaDB (same server as the site) | Single instance, no replica, no PITR, shared-server noisy neighbours, 150 conn / 500 per hour caps | Scheduled off-site encrypted dumps; consider managed MariaDB/MySQL with PITR (PlanetScale-style/Aiven/Cloud SQL) for the system of record |
| Global audit-chain row lock | Serialises logins/staff actions | OPS-05 |
| Single mail mailbox / SMTP quota | Registration/reset depend on it | Transactional mail provider |
| Hostinger edge/CDN ALIAS (TLS, routing, 120 s) | Unknown behaviour for SSE/WebSockets; outage = full outage | External uptime check; status page; low-TTL DNS plan for emergency re-point |
| One Git branch (`main`) wired to production | Any merge redeploys | OPS-02 |
| Human-only runbook controls (no deploy during exams, backups before exams) | No automation | OPS-02, OPS-08 |
| Account-level Hostinger env var set (full replace, masked) | One wrong replace deletes all secrets/config; app may start in dev mode silently (OPS-03) | Keep sealed copy in a password manager/secrets vault; startup assertion on required variables |
| Domain/DNS registrar and TLS auto-renew | Parking change dropped domains for minutes on 2026-11-07 (demo README) | Change freeze for domain operations before exams |

## 5. Capacity analysis by workload (reasoned from code; ALL numbers are estimates)

Reference measurements available (local, 4 vCPU, DB on same host): ~200 candidate starts/s/process; ~600-700 req/s overall at CPU ~50 % for ~1 000 hyper-active candidates; 5 000 candidates at ~20 s/question: save p99 29 ms, host CPU 27 %. Hostinger values unknown; below, "R" = unknown DB RTT multiplier.

| Workload | Per-unit cost from code | Estimated ceiling / risk (single process) | Main bottleneck |
|---|---|---|---|
| Thousands of students signed in (idle dashboards) | bell poll every 30 s (`layout.tsx:19`) = 1 session KV query + notification query; 5 000 users ≈ 170 req/s ≈ 340-500 queries/s steady even with nobody examining | Noticeable constant load; roughly 15-25 % of one core by estimate | per-request KV round trip (OPS-15) |
| Login burst | argon2 verify + audit global lock + session insert + rate-limit upserts (about 10 queries) | tens to ~100 logins/s; 5 000 in 60 s is at/over the limit; 20 000 impossible in a minute | OPS-05, argon2 threadpool (4) |
| Exam start burst | 200 starts/s measured locally | 5 000 starts in 10 s: p50 ~11 s locally; worse with R>1 | event loop + DB driver, OPS-07 |
| Heartbeats | 15 s each ≈ N/15 req/s x ~3 queries: 5 000 -> 333 req/s, ~1 000 q/s | Sustainable locally (27 % CPU at 5 000); on Hostinger scale by R | OPS-15 |
| Answer-save bursts | ~7 round trips, one pooled connection held for the whole tx, row locks on attempt (share) and answer (update) | Locally p50 4 ms at ~250 saves/s; theoretical pool ceiling 20 / (7 x RTT) saves/s: ~4 000/s at 0.35 ms RTT, ~500/s at 3 ms RTT | pool 20, RTT, `answer_events` write |
| Hundreds of simultaneous exams | Per exam with subscribers: DB catch-up poll every 2 s (no Redis) + stats tick 1 s + monitor aggregate every 1.5 s (`events.service.ts:155-171`, `monitor.service.ts:30`); tick loop iterates exams sequentially with awaits | 300 exams with at least one SSE viewer = ~150 catch-up queries/s + ~200 aggregate queries/s baseline; the sequential tick may exceed 1 s and skip (`ticking` guard) so staff panels lag | single-threaded tick; aggregate query on `attempts`/`exam_candidates` |
| Thousands of concurrent attempts + SSE | one socket + 15 s keep-alive timer per stream; cap 20 000/process | memory per stream small (KBs) but all timers on the loop; edge limits unknown (OPS-11) | edge behaviour; reconnect churn |
| 100+ institutions | scoping is by `institutionId` filters and joins; `listInstitutions` includes `_count` joins; `institutionSummary` correlated subqueries per institution (`reports.service.ts:133`) | fine at 100-300 institutions | none |
| Large question banks | list endpoints are paginated (`questions.service.ts:60-69`); paper is snapshotted into `exam_questions.snapshot` JSON at approval; `programs` list is unpaginated with nested courses (`org.service.ts:69`) | tens of thousands of questions fine if indexes exist (not audited here) | bank search `LIKE '%..%'` (full scans) |
| Auto-grading after close | `gradeAttempt` 3 reads + 1 tx, loads whole paper snapshot; pass = 200 per batch, 20 s budget, concurrency 8 (`lifecycle.service.ts:19-20,224-234`) | 5 000 attempts: tens of seconds to a few minutes if the process stays alive | bandwidth of snapshot JSON; process lifetime (OPS-04) |
| Heavy reporting | full-result `findMany` per report/CSV, item analysis group-by over `attempt_answers` (`results.service.ts:66-71`) | OK for 5 000 x 100 answers (500 k rows scan) but runs on the same loop/pool as the live exam | reports during an exam can starve saves; no read replica |
| DB growth | `answer_events` +1 row/save, never deleted (OPS-13) | tens of millions of rows within a few terms | disk + backup time |
| Connection limits | pool 20 + migration child + cron + workstation scripts vs 150 / 500 new per hour | OK if single process and pool <= 25; breaks if a second app instance or a scheduled script opens pools | Hostinger user quota |

## 6. Proposed load-test plan with measurable targets (PROPOSAL - nothing below has been run)

Environment: a staging website on the SAME Hostinger plan/region/DB class as production (do not test on production), TLS DB endpoint exactly as production, `NODE_ENV` production mode (after OPS-03), load generators on external machines in the same country as users (2-3 generators so the generator is not the limit), Next.js included.

Measurements to record every run: p50/p95/p99 per endpoint, error rate by code, Node RSS and event-loop lag (add to deep health), DB threads/connections, `Threads_running`, slow-query log, pool wait count, SSE open count, host CPU if obtainable.

| ID | Scenario | Load shape | Pass targets (proposed starting points; adjust after run 1) |
|---|---|---|---|
| L0 | Baseline probe | 1 request each of health, session, start, save from the generator host; measure RTT to DB from inside the app (log RTT of `SELECT 1` x 100) | RTT recorded; decision on 127.0.0.1 vs srv host |
| L1 | Login ramp | 1 000, 3 000, 5 000 real logins (argon2) over 5, 5, 10 min; campus NAT: 200 logins from one IP | login p95 < 1.5 s; 0 unexpected 429 for NAT case after OPS-06 fix; event-loop lag p99 < 100 ms |
| L2 | Exam-start burst | 1 000 / 3 000 / 5 000 starts within 60 s, then 2 000 within 10 s | start p95 < 2 s at 60 s ramp; < 8 s at the 10 s burst; 0 errors; 0 lost |
| L3 | Steady sitting | 3 000 and 5 000 concurrent, 100 questions, ~25 s per question, heartbeat 15 s, student SSE enabled, notification poll 30 s, 90 min | save p99 < 300 ms, p99.9 < 1 s; heartbeat p99 < 500 ms; error rate < 0.1 %; zero acknowledged-answer loss (reuse integrity check in `exam-load.mjs`); RSS stable (no growth > 10 % over 60 min) |
| L4 | Save burst | all candidates save every 3 s for 2 minutes (worst-case clustered) | save p99 < 800 ms; pool wait p99 < 200 ms |
| L5 | Control storm | during L3: exam-wide extension, suspend, resume x3 | heartbeat stampede: p99 < 2 s during the 20 s after each command; no save errors |
| L6 | Close and grade | 5 000 attempts reaching deadline simultaneously, reconciler alive | all sealed in < 60 s; all graded in < 3 min; receipts replay identically |
| L7 | Concurrent exams | 100 and 300 exams x 20-50 candidates each + 2 staff SSE viewers each | monitor snapshot age p95 < 5 s; DB CPU/threads within provider limits; save p99 < 300 ms |
| L8 | SSE edge test | 1 000 candidate SSE streams for 15 min, count server vs client disconnects, event delivery latency, buffering | document whether the edge cuts at 120 s; delivery p95 < 3 s or documented fallback |
| L9 | Failure drills | restart process mid-exam (hPanel restart), kill DB connections, saturate pool, deploy during run | candidates see no lost answer; recovery < 60 s; reconciler resumes < 30 s |
| L10 | Reporting under load | run item-analysis + CSV for a 5 000-candidate exam during L3 | save p99 degrades < 30 %; report < 20 s |
| L11 | Backup under load | `db-backup.mjs backup` during L3, then `verify` on a workstation; time restore into a fresh Hostinger DB | backup completes; save p99 degrades < 20 %; restore time (RTO) recorded and under the agreed target |
| L12 | Soak | 6 hours at 20 % of L3, with idle gaps > 5 min to test host idling and the reconciler | no unrecovered stall; reconciler staleness alert fired within 2 min if forced |

Go/no-go suggestion: authorise real cohorts only up to the largest size for which L2-L7 pass with 30 % headroom, and re-run before each term.

## 7. Could not verify

- Actual Hostinger limits: CPU cores/share, RAM, process memory ceiling, edge timeouts (120 s), SSE buffering, whether the process is idled, Node cron support, log retention, daily-backup retention/restore, Remote MySQL current allow-list, DB isolation level and `max_user_connections`, MariaDB server RTT from the Node process. All are taken from repository claims only.
- Branch protection and required checks on GitHub; whether Hostinger auto-deploy waits for CI.
- Actual production env var values and secret strength (no secrets were opened); whether `METRICS_TOKEN`, `MFA_KEY`, `TRUST_PROXY` hop count are set correctly.
- Any running behaviour (nothing was executed, per instructions): all latency/throughput figures in sections 5-6 are reasoning or quoted local measurements.
- Whether a Hostinger "WAF/DDoS" layer rate-limits requests before they reach Node.
- Index coverage and query plans on hot tables (not reviewed here; belongs to a database review).
- `.env.example` and `infra/hostinger/env/*.example` contents were not reviewed for secrets.
