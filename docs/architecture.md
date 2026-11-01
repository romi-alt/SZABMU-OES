# Architecture

## Goals and constraints
SZABMU / PIMS Online Examination System serves 100+ constituent and affiliated institutions with an engineering target of
**20,000 simultaneous candidates**. The governing principle: **the PostgreSQL database is the single source of truth for every
answer, deadline and result.** Redis and the browser are accelerators and buffers; losing either must never lose or alter an answer.

## System context
```
 Browser (Next.js / React)  ──HTTPS──►  Next.js server (rewrites /api/*)  ──►  NestJS + Fastify API  ──►  PostgreSQL 16
        │  exam engine: revisioned                                              │    ├─► Redis      (session cache, rate limits,
        │  save queue + crash buffer                                            │    │               paper cache, heartbeats, BullMQ)
        └─ server-synced clock                                                  │    ├─► BullMQ workers (grading, mail, lifecycle sweeper)
                                                                                │    └─► S3-compatible storage (artifacts; adapter configured, not yet exercised)
```

## Monorepo
| Path | Purpose |
| --- | --- |
| `packages/shared` | Role/permission matrix, exam rules (deadline, scoring, digest, receipt, seeded shuffle), password policy. Pure TS, unit-tested, used by API **and** web |
| `apps/api` | NestJS 11 on Fastify. Prisma 7 (driver-adapter `pg`). Modules: auth, org, exams (questions/papers/roster), delivery, results, invigilation, reports/audit/notifications, jobs |
| `apps/web` | Next.js 16 (App Router), React 19, plain CSS design tokens (no UI framework) |
| `tests/e2e` | Playwright against the real stack · `tests/load` load + integrity driver |
| `infra`, `docker-compose.yml` | Dev stack (Postgres, Redis, MinIO, Mailpit) and Dockerfiles |

## Request pipeline (API)
1. Fastify `onRequest` hook — rejects state-changing requests whose `Origin` is not the web origin (CSRF defence for cookie auth).
2. `AuthGuard` (global) — resolves the opaque session cookie → user (in-process cache, 30 s, explicitly invalidated on logout / deactivation / password change / scope change; falls back to PostgreSQL).
   **Deny by default:** a route with neither `@Public()` nor `@Perm()` is rejected at runtime *and* fails a unit test.
3. Permission check against the shared matrix.
4. Zod validation of every body/query (`parse()`), UUID pipes on path ids.
5. Service layer applies **institution scope** to every query, writes the **audit trail**, and returns DTOs (never raw rows with secrets).
6. `AllExceptionsFilter` — uniform JSON errors, no stack traces or SQL.

## Time
All exam timing decisions use the **database clock** (`clock_timestamp()`), never the app server or browser clock. The browser
computes `offset = serverNow − Date.now()` at start and re-syncs on every save acknowledgement and 15-second heartbeat, so the visible
countdown follows the server's deadline, including time extensions granted by invigilators.

## Background processing (BullMQ)
| Queue | Job | Idempotency |
| --- | --- | --- |
| `grade-attempt` | Score one sealed attempt, upsert `results` | `jobId = grade-<attemptId>`; upsert; sweeper recovers any missed job |
| lifecycle tick (in-process, `JobsService`) | Every 10 s: auto-submit expired attempts, grade ungraded, open/close exams, mark absentees, move to `RESULT_PENDING`, retry undelivered mail | Idempotent set-based SQL; assumes one API process (see `jobs.service.ts`) |
| mail | Deliver outbox messages (SMTP/Mailpit) in the background | Outbox row persisted first |

There is no Redis or queue server (web-hosting profile, stage 1): caches and rate-limit counters are in-process (`infra/cache.service.ts`), password-reset tokens and heartbeats are PostgreSQL rows, and the tick plus `finalize()` are DB-driven, so correctness never depended on them.

## Exam lifecycle
`DRAFT → PAPER_PENDING → APPROVED → SCHEDULED → LIVE → CLOSED → RESULT_PENDING → PUBLISHED` (or `CANCELLED` before start).
Result batch: `GRADED → LECTURER_REVIEWED → EXAMINER_APPROVED → PUBLISHED`.

## Scaling notes (see also docs/exam-engine.md §Capacity)
- The hot path is one SQL statement per answer save; API instances are stateless and horizontally scalable behind a load balancer.
- Put **PgBouncer (transaction pooling)** in front of PostgreSQL for >2–3 API replicas; size pools to `cores × 2–4` per replica.
- Partition `answer_events` and `attempt_events` by exam/month before production volumes; retain per audit policy.
- Redis: single primary with AOF is sufficient for current use; use a managed HA offering in production.
