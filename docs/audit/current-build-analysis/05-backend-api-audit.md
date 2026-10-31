# 05 — Backend API audit

## Surface (TODAY: `docs/route-permissions.md`, regenerated/verified by `route-inventory.test.ts` PASS)

98 routes; **every** route declares exactly one `@Perm(...)` or is `@Public()`. 7 are public: `auth/login`, `auth/forgot`, `auth/reset`, `auth/verify-code`, `health`, `public/verify` (rate-limited, `results.controller.ts:30`), `metrics` (bearer token; **404 when `METRICS_TOKEN` unset**, probed TODAY). A structural test fails the build if a route lacks a decision.

Validation: zod schemas in controllers (`parse(z.object(...))`), `ParseUUIDPipe` on ids, body limit 2 MiB (`bootstrap.ts:12`). Errors are normalised by one filter (`common/errors.ts`); out-of-scope records return 404.

## Cross-cutting

- **Guard order**: session → must-change-password → MFA state → permission → service-level scope. MFA-pending sessions are confined to enrolment/verify endpoints (`mfa.test.ts`, 10 PASS).
- **Scope**: `scope.filter(u)` / `scope.assert(u, institutionId)` in services; lecturers additionally pass `CourseAccessService` (deny-by-default; `course-access.test.ts` 13 PASS).
- **Separation of duties** in code: reviewer ≠ author, paper approver ≠ submitter, result publisher ≠ examiner-approver.
- **CSRF**: cookie is `httpOnly`, `sameSite=lax`, `secure` in production; a global `onRequest` hook rejects state-changing requests whose `Origin` is not in `WEB_ORIGIN` (`bootstrap.ts:19-23`; TODAY: evil origin → 403). Requests with **no** `Origin` header pass (non-browser clients / old browsers) — acceptable given SameSite=lax but not a token-based defence.
- **Rate limiting**: Redis counters for login (IP and identity, 900 s), forgot-password, save (>100 per 10 s per attempt), public verify. All **fail open** if Redis is down (policy P-28).
- **Headers (API)**: helmet with CSP disabled (JSON API, fine); HSTS `max-age=31536000; includeSubDomains`, `nosniff`, `X-Frame-Options: SAMEORIGIN`; no `Server`/`X-Powered-By` (TODAY).

## Findings

| # | Finding | Evidence |
|---|---|---|
| B1 | **No exam-control routes**: suspend, resume, open/close admission, exam-wide extension, "initiate result processing" do not exist. Probes `POST /exams/:id/{suspend,resume,open,close,extend,start,results/initiate}` → 404 (TODAY). `docs/implementation-status.md` already records this as P-23. | `route-permissions.md`; live probe |
| B2 | Exam state transitions to `LIVE`, `CLOSED`, `RESULT_PENDING` occur **only** in the BullMQ tick (`results.service.ts:62,65,76`); no API can do it. | SOURCE |
| B3 | `monitor()` loads all candidates + all attempts + a full-exam `GROUP BY` on every call, with no `take`/pagination (`invigilation.service.ts:41-48`). | SOURCE |
| B4 | `tick()` finalises ≤500 expired attempts **sequentially** per 10 s (`results.service.ts:56-58`) and grades ≤500 more; a mass-expiry (outage/clock) at 20,000 candidates would need ≥ 7 minutes. Extrapolation, not measured. | SOURCE |
| B5 | `gradeAttempt` upserts the result unconditionally (`results.service.ts:18-45`). Safe today because key actions are blocked after examiner approval, but there is no guard that refuses to touch a `PUBLISHED` batch. | SOURCE |
| B6 | `listIncidents`, `listE` etc. cap at 200/50/500; `monitor` and `roster` are unbounded. | SOURCE |
| B7 | Temporary passwords are returned in API responses once (`org.service.ts:89,131,158`); users are forced to change them (`mustChangePw`). Acceptable; ensure the channel. | SOURCE |

## Background jobs

BullMQ queues `grade` (concurrency 16), `mail` (4), `sweep` (1, scheduler every 10 s) start only when `RUN_WORKERS=true` (`jobs.service.ts:20-23`). Enqueue is time-boxed (1.5 s) and skipped when the Redis breaker is open; the sweeper recovers un-enqueued grades. **Untested**: sweeper behaviour during Redis outage/restart, two API processes both running workers, tick overrun.

## Events

There is no event bus. Notifications are rows; mail goes through an outbox table + BullMQ. Monitoring is pull-only (see `08`).
