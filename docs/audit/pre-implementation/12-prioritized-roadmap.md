# 12 — Revised Implementation Plan (for review; nothing here has been started)

Principles: preserve verified modules (see 11); change schema only via **new** migrations; every phase ends with typecheck + lint + API tests + (where UI changes) Playwright green, and a docs/implementation-status.md update. Effort: S ≤ 2 d, M ≈ 3–6 d, L ≈ 1–2 wk, XL > 2 wk (one engineer, rough relative sizing, not a commitment).

Sequence: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7**. Phases 0–1 gate everything; 2 precedes 3–4 because it changes the schema they build on.

---
## Phase 0 — Secure the baseline (P0, S)
- **Issue:** most work is uncommitted; CI and Docker never executed.
- **Modify:** none in `src`; stage `docs/ infra/ scripts/ tests/load/ .github/ docker-compose.yml eslint.config.mjs` and the 13 modified files (includes the delivery optimisation, `common/auth.ts`, `results.service.ts`, e2e).
- **New files:** none. **DB:** none. **Endpoints/UI:** none. **Deps:** none.
- **Security:** confirm `.env` stays ignored; run `run_secret_scanning` before push.
- **Tests:** CI workflow executes on GitHub; `docker compose up postgres redis` + `docker compose --profile app build` on a Docker-capable host.
- **Acceptance:** one commit pushed, CI green, compose smoke documented (or failures logged in status doc). No PR unless requested.

## Phase 1 — Prove durability, isolation inventory and scale (P0, L)
- **Issue:** crash-recovery, clock manipulation, multi-process and ≥5k are NOT_VERIFIED; route-level authorisation coverage depends on humans.
- **Modify:** `apps/api/test/exam-engine.test.ts` (add cases), `tests/load/exam-load.mjs` (add `--kill-api-at`, multi-target, login-storm mode), `infra/` (PgBouncer service in compose), `apps/api/src/infra/prisma.service.ts` (pool settings via env), `apps/api/src/modules/jobs.service.ts` (sweeper safety if >1 process).
- **New:** `apps/api/test/route-inventory.test.ts` (reflects over Nest routes: every handler must have `@Perm` or `@Public`; every `:id` handler on a scoped entity must be in an allow-list proven by a cross-campus test), `apps/api/test/fault.test.ts` (spawns API child process, saves answers, SIGKILL, restart, assert all acked answers present), `docs/load-test-plan.md`.
- **DB:** none (maybe indexes revealed by EXPLAIN — as a new migration).
- **Endpoints/UI:** none.
- **Deps:** PgBouncer image (compose); no npm deps.
- **Security:** route inventory is the control; load tests only against synthetic data in a non-prod env.
- **Test cases:** SIGKILL API mid-exam → zero acked answers lost; PG restart mid-save → client retries, no duplicates, no loss; Redis flush mid-exam → exam continues, sessions fall back; two API processes saving/submitting same attempt → single receipt; simulated manipulated browser clock (Playwright `clock` API) → deadline unchanged; 5,000-candidate run with SLOs fixed *before* running (proposal: save p99 < 500 ms, start p95 < 3 s, zero lost).
- **Acceptance:** all above green and published numbers in `09` replaced with measured 5k results; 10k/20k explicitly marked untested if not run.

## Phase 2 — Authorisation and data-model gaps (P0/P1, L)
- **2a Lecturer ↔ course assignment (HIGH).** *DB:* `CourseAssignment(userId, courseId, role, academicTerm, unique(userId,courseId,term))`. *Modify:* `questions.service.ts` (create/edit/list limited to assigned courses for LECTURER), `exams.service.ts` (paper composition from assigned/approved courses), `org.service.ts` + `org.controller.ts` (`POST/DELETE /courses/:id/lecturers`), `packages/shared/permissions.ts` (`course.assign`), `questions/page.tsx`, `programs/page.tsx` (assignment panel). *Tests:* lecturer A cannot create/read questions for unassigned course; campus admin cannot assign across institutions; audit written. *Accept:* matrix test in `security.test.ts` extended and green.
- **2b Venue / exam centre.** *DB:* `Venue(institutionId, name, capacity, code)`; `Exam.venue` text → `ExamVenue(examId, venueId, seats)` with migration copying legacy text to Venue rows where possible. *Modify:* `exams.service.ts` (capacity vs candidate count check, clash detection for the same venue/time), `exams/[id]/page.tsx`. *Accept:* scheduling over capacity or clashing is rejected with 409; tests.
- **2c History tables.** *DB:* `QuestionRevision(questionId, version, snapshot, changedBy)` written on every edit; `ResultRevision(resultId, marks, reason, changedBy)` written on regrade/key action. *Modify:* `questions.service.ts`, `results.service.ts`. *Accept:* every edit/regrade leaves an immutable row (append-only trigger like audit).
- **2d DB-level guards.** New migration: transition-check triggers for `Attempt.status`, `ResultBatch.status`; review all 13 `onDelete: Cascade` and switch evidence-bearing ones to `Restrict`; revoke `DELETE` on evidence tables for the app role (document role setup). *Tests:* illegal transitions rejected at SQL level; delete of exam with attempts fails.
- **Dependencies:** none external. **Risk:** medium (migrations on populated tables → write reversible, tested on a restored copy).

## Phase 3 — Live-exam operations (P1, L)
- Exam-wide **pause/extend/announce**: *DB:* `Exam.pausedAt`, `ExamAdjustment(examId, kind, minutes, reason, by)`; *Modify:* `invigilation.service.ts`, `delivery.service.ts` (deadline recompute from adjustments in one place — preserve save SQL), shared `computeDeadline`; *Endpoints:* `POST /monitor/:examId/extend-all|pause|resume`; *UI:* `monitor/[examId]/page.tsx`. *Tests:* every active attempt deadline moves once (idempotency key); late saves honoured; audit entries. *Security:* only INVIGILATOR (own exam) / CCE; reason mandatory.
- **SSE monitor:** *New:* `GET /monitor/:examId/stream` (Fastify raw SSE), aggregate counters from Redis; fall back to polling. *Accept:* 1,000 concurrent monitor clients do not affect save latency.
- **Monitor columns:** tab-hidden / focus-loss counts from `attempt_events`.
- **Eligibility re-check at start** — needs policy decision (P-24): block vs warn if enrolment/attendance changed after roster build.
- **Dedicated worker entrypoint:** `apps/api/src/worker.ts` (new), compose service; sweeper uses `SELECT … FOR UPDATE SKIP LOCKED`.

## Phase 4 — Missing core functionality (P1, XL)
- **Subjective questions + manual grading.** *DB:* `QuestionType` extend (`SAQ`, `LAQ`), `ManualGrade(attemptId, examQuestionId, marks, feedback, gradedBy, version)`, rubric JSON; `AttemptAnswer.text`. *Modify:* `delivery.service.ts` (new answer variant — **same revision/atomic upsert, add a `textAnswer` column**, length-capped), `results.service.ts` (aggregate MCQ+manual), exam player (textarea with autosave through the same engine), new `grading/page.tsx`. *Security:* double-blind marking option; lecturers see only assigned course scripts; answers sanitised on render. *Tests:* autosave of text with revisions; grader scope; totals; regrade.
- **Materials + object storage.** *New:* `apps/api/src/infra/storage.service.ts` (S3/MinIO via `@aws-sdk/client-s3`), `modules/materials/*`, `Material` model, `materials/page.tsx`. *Security:* MIME sniff + size caps, random keys, private bucket + short-lived signed URLs, malware-scan hook, per-course scope. *Tests:* upload cross-campus denied; oversize/type rejected.
- **Bulk import** (students, questions) with dry-run validation, CSV only, row-level error report, audit.
- **Certificate PDF** (server-side, `pdf-lib` or Playwright print), stored in object storage, hash recorded.

## Phase 5 — Security and operations hardening (P0/P1, L)
2FA (TOTP) mandatory for CCE/SUPER_ADMIN/EXAMINER (`User.totpSecretEnc`, recovery codes; `/auth/2fa/*`); strict CSP in `next.config.mjs`; require Origin/custom header on mutations (`bootstrap.ts`); fail-closed rate limiting with explicit Redis-outage tests; Dependabot + `npm audit` triage + SCA in CI; decision P-25 on answer-key-at-rest (separate `exam_keys` table + restricted DB role); structured logging + Prometheus metrics (`/metrics`), alert rules; automated PG backups + PITR + **restore drill**; secrets via env/secret store, rotation doc. *Accept:* restore drill executed and timed; pen-test checklist (OWASP ASVS L2 subset) signed off.

## Phase 6 — UX, accessibility, role dashboards (P2/P3, M–L)
Per-role dashboards (lecturer: assigned courses/queue; examiner: papers/approvals; campus: eligibility & results); settings/feature toggles (`Setting` model, CCE/Super only); ⌘K search (scoped); axe + keyboard-only + mobile Playwright suites (add `@axe-core/playwright`); screenshot review of all routes for all roles against the deck.

## Phase 7 — Pilot readiness (P1, M)
UAT with a synthetic multi-institution rehearsal (≥ 3 institutions, 500–2,000 candidates on production-like infra); runbooks (open/close exam, incident, restore); approvals of policy decisions P-01…P-25 recorded; independent code + security review (the original author was this AI agent); go/no-go checklist. **Production deployment and real student data remain out of scope until explicit written authorisation.**

---
## Priority map
| P | Items |
|---|---|
| P0 | Phase 0; Phase 1; 2a; 2d; Phase 5 backups/restore, Redis-outage behaviour |
| P1 | 2b, 2c; Phase 3; Phase 4 subjective grading + materials; 2FA; a11y/mobile |
| P2 | bulk import, certificate PDF, per-role dashboards, reports depth |
| P3 | settings, ⌘K search, visual polish |
| P4 | SMS, analytics beyond reports, offline-first PWA exam mode |

## Requirement comparison (Phase 16)
| # | Planned item | Status |
|---|---|---|
| 1 | Node.js exam architecture | Implemented & verified (single node) |
| 2 | Branded frontend | Implemented; 3 screens visually verified, rest source-only |
| 3 | RBAC auth | Implemented & verified; 2FA missing |
| 4 | Institution hierarchy | Partial (no campus/venue, departments no UI) |
| 5 | Campus dashboards | Partial |
| 6 | Registration + eligibility | Implemented; no bulk import; not re-checked at start |
| 7 | Question bank | Implemented; no course assignment, no versions table |
| 8 | Paper prep/approval | Implemented & verified |
| 9 | Scheduling | Partial (venue/capacity/clash missing) |
| 10 | MCQ nav | Implemented & verified (browser) |
| 11 | Review/indicators | Implemented & verified |
| 12 | Durable autosave | Implemented; crash-durability unverified |
| 13 | Server timer | Implemented & verified |
| 14 | Secure submit | Implemented & verified |
| 15 | Monitoring/incidents | Partial (poll, no pause) |
| 16 | Auto + manual grading | Auto verified; manual missing |
| 17 | Approved publication | Implemented & verified |
| 18 | Institution analytics | Partial |
| 19 | Security & audit | Implemented; hardening gaps (see 07) |
| 20 | Scale & recovery testing | 2,000-candidate run only; recovery untested |
