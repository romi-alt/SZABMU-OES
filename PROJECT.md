# PROJECT.md — SZABMU Online Examination Center (handoff)

Start here when continuing this project in a new Claude Code session. Written 2026-11-05 at the end of the previous session.
Everything below was checked against the repository and the live site at that time; re-verify anything time-sensitive.

## 1. What this is

An online examination platform for Shaheed Zulfiqar Ali Bhutto Medical University (SZABMU) and its affiliated colleges.
Students sign up, complete a profile, and sit MCQ papers in a browser exam player; staff (administrators, examination controllers,
examiners, lecturers, teachers, invigilators) build question banks and papers, schedule exams, run live exams, grade and publish results.

- **Product status: INTERNAL_TESTING_READY.** Not certified for a pilot or production. Do not claim production readiness.
- **Live demo (synthetic data only):** student portal **https://szabmu.site** (also `www.`, `oes.szabmu.site`), staff portal **https://dashboard.szabmu.site**.
  Health: `GET https://szabmu.site/api/health` → `{"status":"ok","db":true,"redis":null,"coordination":"database"}` (as of 2026-11-05).

## 2. Repository and branches

- GitHub: **`romi-alt/SZABMU-OES`**. `main` is what is deployed (Hostinger auto-deploys every push to `main`).
- `claude/oes-platform-foundation`: the UI/UX + features branch used by the previous session. At handoff it equals `main` plus the
  student-guide video tooling (`tests/tutorial/`, `playwright.tutorial.config.ts`) and this file — open a PR from it to land those.
- Other sessions have worked in parallel (hosting track: PostgreSQL→MariaDB, Redis removal). **Read `docs/COORDINATION.md` before working**:
  sync with `main` first, merge (never rebase/force-push shared branches), announce migrations, no new Redis/queue usage.
- If the new account cannot see the GitHub repo, unpack this zip, `git init`, and push to a repo the new account can access
  (the zip contains the source but not the git history — see §11).

## 3. Stack and layout

npm workspaces monorepo, Node **>= 24**, TypeScript everywhere.

| Path | What |
|---|---|
| `apps/api` | NestJS 11 on Fastify, Prisma 7 (**MySQL/MariaDB** provider), argon2id auth, cookie sessions, audit log (hash-chained), exam engine, grading, results |
| `apps/web` | Next.js 16 (App Router), one app serving both portals; `src/proxy.ts` resolves the portal from the host and forwards a portal header |
| `packages/shared` | Roles, the central **permission matrix** (`src/permissions.ts`), DTOs, exam rules, portal page lists, links |
| `apps/api/prisma` | `schema.prisma`, `migrations/` (MySQL, from `20261104000000_mysql_baseline`), `migrations-postgres-archive/` (old) |
| `scripts/` | `hostinger-single-site.mjs` (production launcher), `auto-migrate.mjs`, `demo-papers.mjs`, `pg-to-mysql.mjs`, `db-backup.mjs` |
| `tests/e2e` | Playwright browser tests against the real stack (global setup reseeds the dev DB) |
| `apps/api/test` | Vitest API/integration tests (real DB) |
| `tests/tutorial` | Narrated student-guide video generator (see §9) |
| `docs/` | Architecture, security, permissions (`route-permissions.md` is generated), deployment, audits, teacher registration |

Key rules baked into the code:
- **Every API route declares exactly one `@Perm(...)`**; deny by default. `route-inventory` test + `docs/route-permissions.md`
  (regenerate with `UPDATE_ROUTE_MANIFEST=1`). Never weaken authorization.
- Roles: SUPER_ADMIN, CCE, EXAMINER, CAMPUS_ADMIN, LECTURER, **TEACHER** (new, restricted: `program.read`, `teacher.self`, `teacher.work` only — no results/grading/student records), INVIGILATOR, STUDENT.
- Two portals: staff roles sign in only on the dashboard host, students only on the student host.

## 4. Features in place (high level)

- Student sign-up: registration number + email + password + emailed 6-digit code → signed in → one-time **Complete your profile**
  (name, father's name, gender, mobile, college → programme → semester, academic year) → **My Examinations** (Available / Upcoming / Completed).
  Self-declared students are flagged `selfDeclared` and are **not** enrolled, rostered or admitted until an administrator verifies them (`PATCH /api/students/:id {verify:true}`).
- Teacher registration (3 steps) on the student host `/register/teacher`; admin approves identity and each class-subject separately;
  teacher workspace on the dashboard: Overview, My Classes & Subjects, MCQ Pool (CSV import/export), Students (names only), My Profile. Details: `docs/teacher-registration/README.md`.
- Exam engine: four-eyes question and paper approval, frozen paper snapshots, roster versions, eligibility overrides, server-side timer,
  autosave with offline recovery, review screen, submission receipt codes, live exam control/monitoring.
- UI: SZABMU branding ("SZABMU Online Examination Center"), redesigned sign-in, polished exam player, responsive shell. Audit: `docs/ui-ux-audit/`.

## 5. Hosting and deployment (live demo)

Full detail: **`docs/deployment/hostinger-demo/README.md`** (and the production plan in `docs/deployment/hostinger-managed/`).

- Hostinger Cloud Enterprise, **one managed Node.js website** (no Docker, no root, no permanent workers). Node 24.
- **Database: Hostinger managed MariaDB 11.8** (since 2026-11-04; previously Neon PostgreSQL, kept read-only). Limits: 150 connections, 500 new connections/hour.
- **Redis: optional; the live site runs without it** (coordination state in MariaDB, jobs in process).
- Launcher `scripts/hostinger-single-site.mjs`: runs `auto-migrate.mjs` (`prisma migrate deploy`, additive only, idempotent, never fatal, `AUTO_MIGRATE=false` disables), then serves Next.js and the NestJS API in one process (`/api/*` → API).
- **Deploy = merge to `main`.** Hostinger rebuilds automatically (~2 min). Verify afterwards: `/api/health`, a new route, sign-in.
- Environment variables live only in hPanel (never in git): `DATABASE_URL`, `COOKIE_SECRET`, `RECEIPT_SECRET`, `MFA_KEY`, `METRICS_TOKEN`,
  `WEB_ORIGIN`, `TRUST_PROXY`, portal URLs (`NEXT_PUBLIC_*`, build-time), SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM`), `DEV_EXPOSE_CODES=false`.
- The Hostinger connector (MCP) needs to be authorized in the new account's claude.ai connector settings if you want to manage the site from Claude.

## 6. Demo accounts (synthetic, demo only)

Password for all: `Demo-Passw0rd-2026!` — email `<local>@demo.szabmu.invalid`. Staff sign in at dashboard.szabmu.site, students at szabmu.site.

| Local part | Role |
|---|---|
| `super.admin` | Super administrator |
| `cce` | Controller of Examinations |
| `examiner`, `examiner2` | Examiners |
| `admin.a`, `admin.b` | Campus administrators (college A / B) |
| `lecturer.a`, `lecturer.a2`, `lecturer.b` | Lecturers |
| `invigilator.a`, `invigilator.b` | Invigilators |
| `student.a001`… / `student.b001`… | Students (college A / B) |

`scripts/demo-papers.mjs` adds demo papers for a student on the live demo (used for `student.a001`).

## 7. Running locally

```bash
npm ci
cp .env.example .env            # development values only
docker compose up -d mariadb    # MariaDB 11.8 on :3307 (also redis/minio/mailpit available, all optional)
npm run build                   # shared → api → web
npm run db:migrate
npm run db:seed                 # synthetic data; refuses to run in production
npm run dev:api & npm run dev:web   # http://localhost:3000 (API :4000)
```
No Docker? Install MariaDB 11.x locally and point `DATABASE_URL` at it (CI uses `mariadb:11.8`, see `.github/workflows/ci.yml`).

## 8. Quality gates (run before merging)

```bash
npm run lint && npm run typecheck && npm run build
npm test                         # shared + API (needs TEST_DATABASE_URL)
npx playwright test              # browser suite; reseeds the dev database
```
Last full results on the previous stack: shared 58/58, API 324/324 and Playwright ~116 passing. The MariaDB port was verified by the hosting session (see its PRs #24–#26 and CI).
Recurring flake sources: specs sharing an account, strict-mode ambiguous locators, stale servers reused by Playwright (`reuseExistingServer`) — stop old `node` servers before reruns.

## 9. Student guide video

`tests/tutorial/` produces a narrated, subtitled MP4 (one student: sign up → profile → verified/assigned via the real staff API → sit and submit).
Voice: Kokoro neural TTS (offline, `tts.py`, text in `narration.json`). Recording: `playwright.tutorial.config.ts`. Build: `build-video.mjs` (ffmpeg).
Steps in `tests/tutorial/README.md`. **It was written for the earlier PostgreSQL test stack**; it uses only HTTP/UI so it should run on MariaDB,
but has not been re-run since the database move. Never run it against the live site. The last rendered video is in `extras/` of the handoff zip.

## 10. Open items and known limits

1. **SMTP must be configured on the live site** — without it, student and teacher sign-up codes are never delivered (`DEV_EXPOSE_CODES=false` there).
2. Spot-check on the live site after any deploy: a seeded student opens My Examinations; an admin opens Teachers/Students.
3. No class/section model (a "class" = college + programme + semester + session). XLSX import not supported (CSV only).
4. Existing `LECTURER` accounts unchanged (still see results); `TEACHER` is the new restricted role.
5. Self-declared students need admin verification before any exam access (by design).
6. `defaultMarks` on questions is stored but the paper builder does not default to it.
7. Production blockers and the full production plan: `docs/deployment/hostinger-managed/release-blockers.md`.

## 11. Working rules the owner set (keep following them)

- Implement only verified issues; don't rewrite the backend or exam engine; API changes additive; migrations additive and reviewed.
- Never reset or delete data; never touch real student attempts/results; test only on disposable databases.
- Don't deploy or change production data without the owner's explicit approval (merging to `main` deploys).
- Don't claim full WCAG compliance from automated checks; no production-readiness claims.
- Logical commits after reviewing the diff; never commit secrets. Don't create PRs unless asked.
- Communicate plainly; report test failures honestly.

## 12. First steps for the new session

1. Clone `romi-alt/SZABMU-OES` (or push this zip's contents to a repo you can access), read this file, `docs/COORDINATION.md`, `docs/deployment/hostinger-demo/README.md`.
2. `git fetch && git log origin/main -5` — check whether others have moved `main` since 2026-11-05.
3. `curl https://szabmu.site/api/health`.
4. Ask the owner what to do next; candidates: configure SMTP, merge the student-guide tooling PR, re-run the guide on MariaDB, teacher/admin guide videos.
