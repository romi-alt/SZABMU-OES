# PROJECT.md — SZABMU Online Examination Center (handoff, 2026-11-06)

Read this first when continuing the project in a new session. Everything here was verified at the end of the previous session
(commit `1bf723f` on `main`, deployed and live). Re-check anything time-sensitive (`git log origin/main`, `/api/health`).

## 1. What it is, and its status

Online examination platform for Shaheed Zulfiqar Ali Bhutto Medical University (SZABMU) and its affiliated colleges: student sign-up and
profile, MCQ question banks with four-eyes review, paper approval, scheduling, a live exam player, live exam control, grading, moderation,
publication and certificates; plus a restricted teacher workspace.

- **Classification: INTERNAL_TESTING_READY.** The live site is a demo with synthetic data. Do not claim pilot or production readiness.
- **Live:** student portal **https://szabmu.site** (also `oes.szabmu.site`), staff portal **https://dashboard.szabmu.site**.
  Health `GET /api/health` → `{"status":"ok","db":true,"redis":null,"coordination":"database"}`.
- **Repository:** GitHub `romi-alt/SZABMU-OES`. `main` is deployed (Hostinger auto-deploys every push to `main`).
  Working branch `claude/oes-platform-foundation` = `main` + this file.

## 2. Stack and layout (verified)

npm workspaces, Node ≥ 24, TypeScript.

| Path | What |
|---|---|
| `apps/api` | NestJS 11 on Fastify, Prisma 7 on **MariaDB/MySQL**, argon2id, cookie sessions, hash-chained audit log, exam engine |
| `apps/web` | Next.js 16 (App Router), one app for both portals (host decides the portal, `src/proxy.ts`) |
| `packages/shared` | roles, the central permission matrix (`permissions.ts`), exam rules, `psychometrics.ts`, `similarity.ts`, `item-writing.ts` |
| `apps/api/test` | Vitest API/integration tests (35 files) — real database |
| `apps/api/test-fault` | durability fault-injection suite (process kills, DB crash, backup/restore) — disposable MariaDB per run |
| `tests/e2e` | Playwright browser tests (32 specs), axe accessibility scans included |
| `tests/load/exam-load.mjs` | load + integrity test (MariaDB) |
| `tests/tutorial` | narrated student-guide video generator |
| `scripts/` | `hostinger-single-site.mjs` (launcher), `auto-migrate.mjs`, `db-backup.mjs`, `demo-papers.mjs` |
| `docs/` | see §8 |

Rules baked in: every API route has exactly one `@Perm` (deny by default; route manifest `docs/route-permissions.md`, regenerate with
`UPDATE_ROUTE_MANIFEST=1`); campus scoping in queries; the database clock decides all exam timing; approved papers are frozen snapshots.

## 3. Hosting (Hostinger, no VPS)
One managed Node.js website runs the launcher: applies pending migrations (`auto-migrate.mjs`, additive, non-fatal), then serves both portals
and the API in one process. Database: Hostinger managed **MariaDB 11.8** on the same server (150 connections, 500 new connections/hour).
No Redis (coordination in MariaDB). Environment variables live only in hPanel. Details: `docs/deployment/hostinger-demo/README.md`,
`docs/deployment/HOSTINGER_DEPLOYMENT_AUDIT.md`. The Hostinger connector must be authorised in claude.ai connector settings to manage the site from Claude.

## 4. What the previous session did (all merged to `main` as PR #27 and deployed)

**Audit (Phases 0–2, 10–14):** baseline, full audit, benchmark against Inspera/ExamSoft/Questionmark/TAO/SEB, truthful tracker — `docs/audits/`.

**Security fixes, each proven by a test that failed on the old code** (`apps/api/test/audit-hardening.test.ts`):
- SEC-07 (High) MFA brute-force via parallel requests → atomic per-account cap + atomic failure counter.
- SEC-06 (High) sign-up code brute-force (student + teacher) → atomic guess counter.
- SEC-03/04 reset-code guess race; unlimited codes via rotating IPs → fixed. SEC-05 wrong role in reset audit → fixed.
- SEC-01 session cookie without `Secure` on the HTTPS demo → fixed in code (Secure when origins are https).
- SEC-02 unbounded integrity-event data → bounded and rate-limited.
- SEC-08 forgeable client IP → `TRUST_PROXY` now accepts a hop count; **live value not yet set** (see §6).

**Assurance:** fault-injection suite ported from PostgreSQL to MariaDB (`npm run test:fault`: 17 passed, 1 skipped opt-in benchmark);
backup tool's restore server fixed (`--no-defaults`); load test ported; four untested failure scenarios now tested (`failure-scenarios.test.ts`).

**Performance (local 4-vCPU machine, one API process — not Hostinger):** realistic pace 1 000 / 3 000 / 5 000 candidates: 0 errors, 0 lost
answers (5 000: start p95 20 ms, save p95 15 ms). The limit is a **start burst**: ≈200 starts/s per process (5 000 starts in 10 s → median wait ≈10 s).
Start path made ~9 % faster. Details: `docs/audits/IMPLEMENTATION_TRACKER.md` §2/§2b.

**Features (deterministic — no AI provider, nothing leaves the system):**
- Item statistics on the exam's item analysis: difficulty, discrimination (27 %), corrected item–rest r, KR-20/SEM, sample-size warning.
- "Possible duplicates…" in the question bank (`GET /questions/duplicates`, scoped like the list).
- Item-writing advice in the question editor and review view (7 rules; 4/127 seeded questions flagged).
- Enrolment term chosen from terms in use (`GET /courses/:id/terms`) — prevents typo terms.

**UI/accessibility:** axe scans now actually run (they were silently skipped — missing dev dependency `@axe-core/playwright`, now added);
exam palette Label-in-Name fix; confirmations for deactivate / reset password; explained sign-in and change-password buttons; plain-language
audit filters; live monitor tidy-up. Remaining UI findings listed in `docs/audits/UI_UX_FINDINGS.md`.

**Earlier in the same project:** teacher registration + MCQ pools, student onboarding, auto-migrate, sign-in redesign, branding,
narrated student guide video (`tests/tutorial`).

## 5. Test status at handoff (executed, disposable MariaDB 10.11, no Redis)

| Gate | Command | Result |
|---|---|---|
| Lint / typecheck / build / migrate | `npm run lint`, `npm run typecheck`, `NODE_ENV=production npm run build`, `npm run db:migrate` | pass |
| Shared unit | `cd packages/shared && npx vitest run` | 77/77 |
| API integration | `cd apps/api && npx vitest run` | 352/352 |
| Browser | `npx playwright test` | 135 passed, 0 failed |
| Fault suite | `npm run test:fault` (needs `mariadb-install-db`/`mariadbd` on PATH) | 17 passed, 1 skipped |

Live after deploy (2026-11-06, no sign-in): health ok, both portals 200, new routes answer 401 (exist), signed-out `/auth/me` 401.

## 6. Open items (in priority order)

Blocked on the owner / Hostinger access:
1. **SMTP** on the live site (sign-up and reset codes are not emailed without it) — verify end to end.
2. **`TRUST_PROXY`**: measure Hostinger's proxy hop count (send a known `X-Forwarded-For`, observe what arrives) and set it in hPanel.
3. **Production mode:** API `NODE_ENV=production`, `MFA_ENFORCE=true`; confirm `WEB_ORIGIN` lists only `https://` origins (Secure cookie).
4. **Backup restore drill and rollback rehearsal** on production data (`docs/deployment/ROLLBACK_AND_RECOVERY.md`).
5. **Capacity on Hostinger** (staging copy of the plan); decide how to handle a synchronized start of thousands (stagger per campus, earlier lobby, more processes).
6. **AI features with an LLM** (drafting, AI review, Bloom): off until a provider and data handling are approved (`docs/ai/AI_GOVERNANCE_AND_PRIVACY.md`).
7. Policy: Safe Exam Browser for on-site exams; answer-key encryption at rest; university authorisation for a live exam.

Can be done in code without approval:
8. Remaining UI findings A-03, A-04, A-05, A-09, A-13…A-18 (`docs/audits/UI_UX_FINDINGS.md`).
9. Manual screen-reader pass of the exam journey (NVDA/VoiceOver) — automated scans pass but are not a WCAG claim.
10. Add the fault suite to CI (needs MariaDB binaries on the runner; `.github/workflows/ci.yml` is a shared file — see `docs/COORDINATION.md`).
11. Option shuffling (where safe), images in question stems, blueprint/coverage report (deterministic), a dedicated teacher-registration brute-force test.

The full checklist for a real examination: `docs/deployment/PRODUCTION_READINESS_CHECKLIST.md`.

## 7. Running it locally

```bash
npm ci
cp .env.example .env                      # development values only
# MariaDB: docker compose up -d mariadb   (port 3307)  — or a local MariaDB 10.11+/11.x on 3307 with user oes / oes_dev_password
npm run build && npm run db:migrate && npm run db:seed
npm run dev:api & npm run dev:web         # http://localhost:3000
```
Test environment used by the previous session (no Redis, like Hostinger):
`DATABASE_URL=mysql://oes:oes_dev_password@127.0.0.1:3307/szabmu_oes TEST_DATABASE_URL=mysql://oes:oes_dev_password@127.0.0.1:3307/szabmu_oes_test REDIS_URL= OES_TEST_KV=database`
plus `COOKIE_SECRET`/`RECEIPT_SECRET` (any ≥ 36-char dev values). Playwright's global setup re-seeds the dev database each run.
A Redis on 6390 only needs to exist for `redis-cli flushall` in the e2e setup. Stop stale API/web servers before reruns (Playwright reuses them).

Demo accounts (synthetic): password `Demo-Passw0rd-2026!`, email `<local>@demo.szabmu.invalid` — `super.admin`, `cce`, `examiner`, `examiner2`,
`admin.a`, `admin.b`, `lecturer.a`, `lecturer.a2`, `lecturer.b`, `invigilator.a`, `invigilator.b`, `student.a001…`, `student.b001…`.

## 8. Documents to read
- `docs/audits/FULL_SYSTEM_AUDIT.md` (overview), `IMPLEMENTATION_TRACKER.md` (every task with evidence and status), `SECURITY_FINDINGS.md`,
  `DATA_INTEGRITY_FINDINGS.md` (20 failure scenarios), `UI_UX_FINDINGS.md`, `GLOBAL_EXAM_PLATFORM_BENCHMARK.md`.
- `docs/deployment/HOSTINGER_DEPLOYMENT_AUDIT.md`, `PRODUCTION_READINESS_CHECKLIST.md`, `ROLLBACK_AND_RECOVERY.md`, `hostinger-demo/README.md`.
- `docs/ai/AI_FEATURE_ASSESSMENT.md`, `AI_GOVERNANCE_AND_PRIVACY.md`, `AI_IMPLEMENTATION_STATUS.md`.
- `docs/COORDINATION.md` (other sessions may work here: sync with `main`, announce migrations, no new Redis usage).

## 9. Working rules the owner set
- Merging to `main` deploys: **only deploy with the owner's explicit approval.** Never change or delete live/production data; test only on disposable databases.
- Implement only verified issues; prove fixes with tests that fail first; report test results honestly with commands and output.
- Don't rewrite the backend or exam engine; API changes additive; migrations additive and reviewed.
- Never weaken authorization; every route keeps exactly one `@Perm`.
- AI never changes marks, results, eligibility or exam state; no external AI provider without approval.
- Small logical commits after reviewing the diff, no secrets; no pull request unless asked; plain language to the owner.
