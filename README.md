# SZABMU Online Examination System (OES)

Online examination and institutional management platform for **Shaheed Zulfiqar Ali Bhutto Medical University, Islamabad** (SZABMU / PIMS) —
100+ constituent and affiliated medical, dental, nursing and allied-health institutions; engineering target 20,000 simultaneous candidates.

> **Status: development build, not production-ready.** See [`docs/implementation-status.md`](docs/implementation-status.md) for exactly what is complete, in progress, blocked and untested,
> and [`docs/policy-decisions.md`](docs/policy-decisions.md) for institutional decisions that need approval. All data in development is synthetic.

## Stack
Node.js 26 · TypeScript · Next.js 16 / React 19 · NestJS 11 on Fastify · PostgreSQL 16 + Prisma 7 · Redis · BullMQ · S3-compatible storage (MinIO) · Docker Compose · Playwright · Vitest.

## Quick start
```bash
nvm use                      # Node 26 (see .nvmrc)
cp .env.example .env         # development-only secrets
docker compose up -d postgres redis minio mailpit
npm install
npm run build:shared
npm run db:migrate           # applies prisma/migrations
node --env-file=.env apps/api/dist/seed/seed.js --reset   # after `npm run build`; SYNTHETIC data, dev only
npm run dev:api              # http://localhost:4000/api/health
npm run dev:web              # http://localhost:3000
```
All seeded accounts use the password printed by the seeder (`Demo-Passw0rd-2026!`) and `@demo.szabmu.invalid` addresses (reserved TLD — can never be real mail):

| Role | Sign-in |
| --- | --- |
| Student (campus A/B) | `student.a002@…` … `student.a024@…`, `student.b002@…` (`…001` is below the attendance threshold) |
| Lecturer | `lecturer.a@…`, `lecturer.a2@…`, `lecturer.b@…` |
| Examiner | `examiner@…`, `examiner2@…` |
| Campus administrator | `admin.a@…`, `admin.b@…` |
| Invigilator | `invigilator.a@…`, `invigilator.b@…` |
| Controller of Examinations | `cce@…` |
| Super administrator | `super.admin@…` |

A live demonstration exam (*Pathology Mid-term (DEMO)*, 12 questions, 45 min) is open for the seeded students.
Password-recovery codes are shown on screen only when `DEV_EXPOSE_CODES=true`; otherwise they are mailed (Mailpit at http://localhost:8025).

## Quality gates
```bash
npm run typecheck && npm run lint
npm test                 # shared unit tests + API integration/security tests against a real PostgreSQL + Redis (TEST_DATABASE_URL)
npm run build && npx playwright test        # browser tests against the real stack
npm run test:load -- --candidates 2000 --questions 50 --think 3000   # load + integrity verification
node scripts/gen-permissions-doc.mjs        # regenerate docs/role-permissions.md
```

## Documentation
[Architecture](docs/architecture.md) · [Data model](docs/data-model.md) · [Role–permission matrix](docs/role-permissions.md) · [Exam engine protocol](docs/exam-engine.md) ·
[Design system](docs/design-system.md) · [Security](docs/security.md) · [Policy decisions](docs/policy-decisions.md) · [Implementation status](docs/implementation-status.md)

## Repository layout
`apps/api` NestJS API · `apps/web` Next.js app · `packages/shared` shared rules/types · `tests/e2e` Playwright · `tests/load` load driver · `design/reference` supplied logo and design deck · `infra` Dockerfiles.
