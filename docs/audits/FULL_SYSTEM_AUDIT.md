# Full-system audit — SZABMU Online Examination Center (2026-11-06)

Companion documents: `SECURITY_FINDINGS.md`, `DATA_INTEGRITY_FINDINGS.md`, `UI_UX_FINDINGS.md`, `GLOBAL_EXAM_PLATFORM_BENCHMARK.md`, `IMPLEMENTATION_TRACKER.md`.
Classification of the product is unchanged: **INTERNAL_TESTING_READY**. Nothing in this audit was deployed or run against live data.

## 1. Repository and technology (verified)

| Part | Implementation |
|---|---|
| Monorepo | npm workspaces; Node ≥ 24; TypeScript throughout |
| API `apps/api` | NestJS 11 on Fastify; Prisma 7 on **MySQL/MariaDB** (Hostinger MariaDB 11.8 since 2026-11-04); argon2id; cookie sessions; Zod validation; ~6 000 lines of hand-written source in 13 modules |
| Web `apps/web` | Next.js 16 App Router, one app for both portals (host-based portal resolution in `src/proxy.ts`) |
| Shared `packages/shared` | roles, the central permission matrix, exam rules (timing, scoring), portal page lists |
| Coordination | Redis optional; without it, state and jobs live in MariaDB and in process (the live configuration) |
| Deployment | Hostinger managed Node.js, one process (`scripts/hostinger-single-site.mjs`): auto-migrate → API and Next in one HTTP server; auto-deploy from `main` |
| Tests | Vitest (shared 58, API 30 files), Playwright (25 specs), fault-injection suite `apps/api/test-fault` (see DI-05), load script `tests/load/exam-load.mjs` |
| CI | GitHub Actions: `verify` (Node 26, MariaDB 11.8, Redis) and `node24` (MariaDB only) — typecheck, lint, unit/API tests, build, e2e on `verify` |

## 2. Functionality by portal (verified in code and tests)

**Student portal (szabmu.site / oes.szabmu.site):** sign-up with registration number + email + password + emailed code → signed in → one-time profile
(name, father's name, gender, mobile, college → programme → semester, academic year) → My Examinations (Available / Upcoming / Completed, with
"not eligible" reasons) → instructions → exam player (one question or all on one page, palette with answered/not answered/not visited/marked,
keyboard navigation, autosave with server-confirmed state, offline queue, review screen, confirmed submission, receipt) → published results and certificates.
Self-declared students cannot sit exams until an administrator verifies them (by design).

**Staff dashboard (dashboard.szabmu.site):** institutions, programmes/courses, users, students (verify), enrolment and eligibility, question bank with
four-eyes review, paper assembly and approval, scheduling, roster and overrides, live exam control (state machine), monitor, invigilation and incidents,
grading/item analysis/key actions, lecturer review → examiner approval → publication, reports and CSV, audit trail with chain verification, notifications.

**Teacher workspace (dashboard, TEACHER role):** three-step registration with administrator approval of identity and of each class-subject;
Overview, My Classes & Subjects, MCQ Pool (CSV import/export, submit for review), Students (names only), My Profile. No results access (enforced in API and queries).

## 3. Security and reliability mechanisms (verified)
Server/database clock for all timing; per-answer revisions with row locks; save/seal serialisation; seal-once with HMAC receipts; single active client;
immutable paper snapshots; explicit exam state machine with audited, idempotent commands; reconciler with leases; deny-by-default authorization with a
structural test; campus scoping in queries; hash-chained append-only audit log; Origin-based CSRF defence; httpOnly/SameSite cookies; MFA (TOTP + recovery);
rate limits; CSV formula-injection neutralisation; database CHECK/unique constraints and append-only triggers.

## 4. Baseline (before any change in this audit) — executed 2026-11-06

Environment: disposable MariaDB 10.11 on :3307 (READ COMMITTED), no Redis; commit `d6f297f`.

| Gate | Command | Result |
|---|---|---|
| Lint | `npm run lint` | pass |
| Typecheck | `npm run typecheck` | pass |
| Production build | `NODE_ENV=production npm run build` | pass |
| Migrations | `npm run db:migrate` | pass |
| Shared unit tests | `cd packages/shared && npx vitest run` | 58/58 |
| API integration tests | `cd apps/api && npx vitest run` | **335/335** (30 files) |
| Browser tests | `npx playwright test` | **118 passed, 4 skipped, 0 failed** (the 4 skipped = all axe scans, UI-A11Y-00) |
| Fault-injection suite | `npm run test:fault` | **cannot run** (still targets PostgreSQL, DI-05) |

Final numbers after the changes are in `IMPLEMENTATION_TRACKER.md` §3.

## 5. Most serious verified weaknesses
1. **SEC-07 (High):** TOTP second factor brute-forceable with parallel requests — fixed and verified.
2. **SEC-06 (High):** sign-up email codes brute-forceable with parallel requests (account on someone else's address) — fixed and verified.
3. **DI-05 (High assurance gap):** the crash/fault durability suite was left behind on PostgreSQL; the strongest durability evidence does not apply to the current database — open.
4. **Capacity on Hostinger unmeasured.** Locally (ported load test, MariaDB, one Node process): integrity held up to 1 000 highly active candidates, but start p95 reached ≈3 s and save p50 ≈250–340 ms at 1 000 while CPU stayed ≈50 % — the single API process is the limit (T-PERF-02). Hostinger itself (150 DB connections, 500 new connections/hour, unknown CPU share) needs a staging copy.
5. **SEC-08:** client IP from a forgeable header affects per-IP limits and audit IPs — mitigated by per-account limits; root fix needs the real proxy hop count.
6. **UI-A11Y-00/01:** automated accessibility checks never ran; one Level-A failure on the exam palette — fixed and verified.
7. Production posture of the demo (SMTP absent, MFA/portal enforcement off, API in development mode) — must change before a real examination.

## 6. Prioritised plan (risk and dependency order)
- **P0 (done in this audit):** SEC-03/04/06/07, SEC-01/02/05, UI-A11Y-01, A-12.
- **P1 next:** port the fault suite to MariaDB (T-QA-01); MariaDB load test on a disposable stack, then a staging copy (T-PERF-01); proxy hop count (SEC-08) on staging;
  production configuration (SMTP, MFA, portal enforcement, `NODE_ENV=production`); backup restore drill; manual screen-reader pass of the exam journey.
- **P2:** remaining UI findings A-03…A-11; option shuffling; item images; deterministic item statistics (discrimination, point-biserial, KR-20 with sample-size caveats).
- **P3:** AI features behind governance (only after the AI assessment and approval), SEB integration, QTI export.

The phases of the brief that are **not started** are listed truthfully in the tracker (AI features, full admin IA redesign, load tests at 3 000/5 000, Hostinger
deployment audit documents) — they were not skipped silently; they are next in the plan.
