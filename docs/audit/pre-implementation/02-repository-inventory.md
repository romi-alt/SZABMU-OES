# 02 — Repository Inventory

Legend: **V** verified (file/command evidence) · **I** inferred · **U** unknown.

| Item | Finding | Status | Evidence |
|---|---|---|---|
| Root / branch | `/home/user/SZABMU-OES`, `claude/oes-platform-foundation`; origin `romi-alt/SZABMU-OES` (private) | V | `git branch` |
| History | 4 commits: initial, foundation, tests+audit fixes, Next.js frontend | V | `git log` |
| Working tree | 13 modified files + untracked `.github/ docker-compose.yml docs/ eslint.config.mjs infra/ scripts/ tests/load/` — **uncommitted** | V | `git status` |
| Package manager | npm workspaces: `packages/shared`, `apps/api`, `apps/web` | V | root `package.json` |
| Node | 26.13 at `/opt/node26`; `.nvmrc` = 26 | V | `node -v` |
| API | NestJS 11 + Fastify (CJS), zod validation, BullMQ, ioredis, argon2id, nodemailer | V | `apps/api/package.json` |
| DB | PostgreSQL 16 (port 5433), Prisma 7.10 + `@prisma/adapter-pg`; 31 models; 3 migrations (`init`, `integrity_constraints`, `exam_term_review`) | V | `schema.prisma`, `migrations/` |
| Web | Next.js 16 App Router, React 19, plain CSS tokens, client-side fetch via `/api` rewrite | V | `apps/web` |
| Frontend routes | 23 `page.tsx` files (login, forgot, verify, exam player, 19 app pages incl. dynamic) | V | `find … page.tsx` |
| API controllers | 8 controllers, ~85 route handlers | V | grep count |
| Tests | shared 15, api 96, e2e 13 (Playwright), load driver `tests/load/exam-load.mjs` | V | test dirs |
| CI | `.github/workflows/ci.yml` present but **never executed on GitHub** (untracked) | V/U | file exists; no run |
| Docker | `docker-compose.yml`, `infra/Dockerfile.{api,web}` exist; **never run** (no daemon) | V | files; U for behaviour |
| Env | `.env.example` committed to be (untracked now); `.env` git-ignored; dev-only secrets, `DEV_EXPOSE_CODES=true` in example | V | files |
| Docs | `docs/*.md` (architecture, data-model, exam-engine, security, design-system, policy-decisions P-01..P-23, implementation-status) | V | `ls docs` |
| Object storage | MinIO in compose only; **no adapter code** | V | grep `upload/multipart` = none |
| WebSocket/SSE | none | V | grep |
| Rate limiting | Redis counters on login (IP 60 / id 20), OTP reset attempts ≤5, save abuse guard 100 per 10 s per attempt | V | `auth.service.ts:38,118`, `delivery.controller.ts:35` |
| Design assets | `design/reference/IMG_0586.png` (logo, used in `apps/web/public/logo.png`), print-deck PDF (a "concept prototype") | V | files |
| TODO/FIXME/mock markers in src | none found | V | grep |
