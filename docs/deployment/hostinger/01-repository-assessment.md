# 01 — Repository assessment

> **Superseded plan.** This folder describes a self-managed VPS deployment. The current direction is Hostinger **managed** hosting with external services: see [`../hostinger-managed/`](../hostinger-managed/). The repository audit below remains valid; the infrastructure parts do not apply.

Scope: the existing SZABMU/PIMS Online Examination System, assessed for deployment to **https://oes.szabmu.site** (students) and **https://dashboard.szabmu.site** (staff/admin) as two portals of one platform. Nothing was deployed, no DNS was changed, no migration was run.

Assessed on branch `claude/hosting-hostinger-plan`, created from `origin/claude/oes-platform-foundation` at `c6726b0`. That branch is still moving (another session is working on it); re-run `git log` before relying on any file path here.

## What exists (preserve all of it)

| Layer | Fact (file) |
|---|---|
| Monorepo | npm workspaces: `apps/api`, `apps/web`, `packages/shared`. Node **≥ 26** (`package.json` engines, `.nvmrc`, both Dockerfiles `node:26-slim`, CI `setup-node 26`). |
| API | NestJS 11 on **Fastify**, global prefix `/api`, 126 route handlers, Prisma 7 + `pg`. Entry `apps/api/src/main.ts`; app factory `bootstrap.ts` (cookies, helmet, CSRF Origin hook, metrics hook). Body limit 2 MiB. |
| Web | **One** Next.js 16 / React 19 app (`apps/web`): route group `(app)` + `exam/[examId]` + `login`, `forgot`, `mfa`, `verify`. Same-origin calls only: `fetch('/api/…')`, `credentials: 'same-origin'` (`src/api.ts`). `next.config.mjs` rewrites `/api/*` to `API_INTERNAL_URL`. CSP with per-request nonce in `src/proxy.ts`, `connect-src 'self'`. |
| Database | PostgreSQL 16. **8** Prisma migrations, DB-level integrity (append-only audit/answer journal triggers, immutable submitted answers, partial unique indexes). |
| Redis | cache (session 120 s, approved paper), rate-limit counters, password-reset tokens, heartbeat sorted sets, BullMQ queues (grade, mail), pub/sub for live events. Correctness does not depend on it (docs/audit/live-exam-control). |
| Lifecycle | `modules/control/lifecycle.service.ts`: DB-lease reconciler (5 s tick, 15 s lease, `SKIP LOCKED`), idempotent, safe on several processes; runs inside the API process when `RUN_WORKERS=true`. |
| Auth | Opaque session token, hashed (`sessions.tokenHash`), cookie `oes_session`: `HttpOnly; SameSite=Lax; Secure` in production; **no `Domain` attribute (host-only)**. Argon2id passwords, lockout after 5 failures / 15 min, TOTP MFA (`MFA_ROLES`: SUPER_ADMIN, CCE, EXAMINER, CAMPUS_ADMIN), recovery codes. No self-service sign-up: accounts are created by administrators (`POST /users`, `/students`, `/students/import`). |
| Config safety | `productionProblems()` in `apps/api/src/config.ts` refuses to boot on weak/example secrets, non-https origins, DB without `sslmode=require`, Redis without password, `DEV_EXPOSE_CODES=true`, `TRUST_PROXY` off, MFA off, non-default login limits. Seed refuses `NODE_ENV=production`. |
| Observability | `GET /api/metrics` (bearer `METRICS_TOKEN`, off if unset), 14 alert rules (`infra/observability/alerts.yml`), `/api/health`. |
| Backups | `scripts/db-backup.mjs` (consistent snapshot dump + disposable-cluster restore verification). Not scheduled, not encrypted, no PITR (docs/operations/backup-restore.md). |
| Packaging | `infra/Dockerfile.api`, `infra/Dockerfile.web` (written, not yet built in CI), `docker-compose.yml` (**development only**, loopback ports). |
| CI | `.github/workflows/ci.yml`: one `verify` job (typecheck, lint, tests, build, Playwright). No image build, no deploy job. |
| Maturity | Project's own classification: **INTERNAL_TESTING_READY**. Load evidence: 2,000 synthetic candidates × 50 questions on one 4 vCPU / 16 GB box, 100,000 acknowledged answers, 0 lost. Nothing beyond that. |

## Deployment features that do NOT exist yet

| # | Gap | Evidence | Consequence |
|---|---|---|---|
| G1 | No tool to create the **first real administrator** | `apps/api/src/seed/` holds only the demo seed, which refuses production | A fresh production database cannot be logged into. |
| G2 | `npm run worker` points at a missing file | `apps/api/package.json` → `dist/worker.js`; no `src/worker.ts` | Workers only run inside the API process. Fine for one VPS; the script must be fixed or removed. |
| G3 | Mail cannot authenticate to SMTP | `infra/mail.service.ts` builds the transport with host/port only; no user/password config | Password recovery needs an unauthenticated STARTTLS relay, or code. |
| G4 | No portal binding | Role-based nav only; any role may use any page on any host | **Added in this branch**, default off (see doc 05). |
| G5 | Authenticated API responses carry no `Cache-Control` | only SSE and `/metrics` set it | nginx must add `no-store` on `/api/`; the API should too. |
| G6 | CSRF check accepts a request with **no** `Origin` | `bootstrap.ts` hook rejects only a *wrong* Origin | `SameSite=Lax` covers browsers; recommend requiring Origin on state-changing requests in production. |
| G7 | MFA not required for LECTURER and INVIGILATOR | `MFA_ROLES` has four roles | Staff portal exposes question/roster/monitor data to accounts with password-only sign-in. Policy decision. |
| G8 | Per-IP sign-in limit (60 / 15 min) vs campus NAT | `LOGIN_RATE_IP_MAX` default 60, production refuses other values | Hundreds of candidates behind one campus IP will be throttled at exam start (risk R-07). |
| G9 | Object storage configured but unused | `S3_*` in config; no S3 client in `src/` | There is no medical-image upload/serving path to deploy yet. |
| G10 | Session cookie is not `__Host-` prefixed | `SESSION_COOKIE = 'oes_session'` | The apex `szabmu.site` is served by another host (`2.57.91.91`); a sibling could set a domain cookie of the same name (cookie tossing). The prefix makes the browser refuse that. |
| G11 | No staging environment, no deploy pipeline, images unbuilt | CI + Docker files | First real image build would happen on the VPS. |

## Recommended order (detail in doc 08)

1. Restore the VPS and decide the open questions (below). 2. Land the small backend fixes (G1, G3, G5, G6, G10). 3. Build images in CI. 4. Rehearse on the VPS under a **temporary hostname you control** (no public DNS change). 5. Separate release gate → DNS → go-live.

## Open questions that change the plan

1. Expected **peak concurrent candidates** per exam (the only capacity evidence is 2,000).
2. Is the staff portal allowed to be reachable from the public internet, or should it be IP-restricted (campus/VPN)?
3. MFA for LECTURER and INVIGILATOR: required on the staff portal? (policy)
4. Which mail provider/relay will send recovery codes for `szabmu.site`?
5. New empty production database, or a controlled import of real records? (doc 06 recommends empty + import of reference data only.)
