# 04 — Feature Completion Matrix

Status key: VERIFIED_COMPLETE (UI+API+DB+permissions+automated test evidence) · PARTIAL · UI_ONLY · MOCK · BROKEN · MISSING · NOT_VERIFIED.
"Test evidence" = automated tests that exist and passed (API/shared re-run today; E2E = last session, not re-run). No percentages are given: completion is counted below as *features by status*, denominator = rows in this table.

| Module | Feature | Status | Source | Endpoint | Model | Test evidence | Sev. | Action |
|---|---|---|---|---|---|---|---|---|
| Auth | Sign-in, logout, session cookie | VERIFIED_COMPLETE | `auth.service.ts`, `login/page.tsx` | `POST /auth/login,logout`, `GET /auth/me` | User, Session | auth.test, e2e auth | – | keep |
| Auth | Lockout (5/15 min), IP/id rate limit | VERIFIED_COMPLETE (lockout) / NOT_VERIFIED (limiter if Redis down) | `auth.service.ts:13,38` | login | User | auth.test | M | test Redis outage; lockout allows victim DoS (accepted?) |
| Auth | Forgot → OTP → reset, history, policy | VERIFIED_COMPLETE | `auth.service.ts:118+` | `/auth/forgot,verify,reset` | PasswordReset/History | auth.test, e2e | – | keep; test real SMTP |
| Auth | 2FA / MFA | MISSING | – | – | – | – | M | add TOTP for staff roles |
| RBAC | Permission matrix, deny-by-default, campus scope | VERIFIED_COMPLETE (API) | `common/auth.ts`, shared `permissions.ts` | all | UserInstitution | security.test (50) | – | keep |
| RBAC | Role management UI | MISSING (roles are a fixed enum; users page assigns role) | `users/page.tsx` | `/users` | User | – | L | decide if custom roles needed |
| Org | Institutions (≡ campuses), programs, courses CRUD | PARTIAL | `org.service.ts` | `/institutions,/programs,/courses` | Institution, Program, Course | workflow.test | M | no sub-campus/venue/department UI; no course-offerings by term |
| Org | Departments | PARTIAL (model exists, no UI) | schema | – | Department | – | L | add UI or drop |
| Org | Staff mgmt (create, institutions, deactivate) | PARTIAL | `users/page.tsx` | `/users` | User | security.test | M | add bulk import, invite flow |
| Students | Directory, register, edit, scope | VERIFIED_COMPLETE (single create) | `students/page.tsx` | `/students` | Student | security.test, e2e staff | – | add CSV import (MISSING) |
| Students | Enrolment, attendance %, eligibility, condonation | PARTIAL | `enrolment/page.tsx` | `/enrolments,…/attendance` | Enrollment | workflow.test | M | attendance is one number; no per-session attendance |
| Questions | Author/edit/submit/review/approve (four-eyes), clinical vignette | VERIFIED_COMPLETE | `questions.service.ts` | `/questions` | Question, QuestionOption | workflow.test | – | keep |
| Questions | Version history | PARTIAL (int counter only, no history rows) | schema:358 | – | Question | – | M | add QuestionRevision table |
| Questions | Lecturer ↔ course assignment | MISSING | – | – | – | – | **H** | any lecturer in institution can author for any course |
| Questions | Course materials upload | MISSING | – | – | – | – | M | needs S3 adapter + AV scan |
| Questions | Bulk import | MISSING | – | – | – | – | M | |
| Papers | Compose, submit, approve (submitter ≠ approver), freeze snapshot | VERIFIED_COMPLETE | `exams.service.ts` | `/exams/:id/*` | Exam, ExamQuestion | workflow.test, e2e | – | keep |
| Scheduling | Create/schedule/cancel, candidates roster, eligibility gate | PARTIAL | `exams/page.tsx` | `/exams` | Exam, ExamCandidate, ExamInstitution | workflow.test | M | venue free text, **no capacity/clash check**; no exam-wide pause/extend |
| Delivery | Start/resume, seeded order, active-client claim | VERIFIED_COMPLETE | `delivery.service.ts` | `/attempts/start` | Attempt | exam-engine.test, e2e | – | keep |
| Delivery | Navigation, skip, mark, clear, Save&Next, palette, filters, review | VERIFIED_COMPLETE (browser) | `exam/[examId]/page.tsx`, `exam-engine.ts` | `PUT /attempts/:id/answers/:qid` | AttemptAnswer, AnswerEvent | e2e exam.spec (3), shared tests | – | keep; add a11y keyboard audit |
| Delivery | Durable autosave, revision ordering, dedupe, stale-tab 409 | VERIFIED_COMPLETE (API+PG) | `delivery.service.ts` | same | same | exam-engine.test (20), load run | – | add crash test (see 05) |
| Delivery | Server timer, extensions, auto-submit | VERIFIED_COMPLETE (API) / e2e for auto-submit | `shared/exam-rules.ts`, sweeper | `/attempts/:id/*`, `/monitor/*extend` | Attempt | exam-engine.test, e2e | – | keep |
| Delivery | Idempotent submit + receipt, post-submit immutability | VERIFIED_COMPLETE | `delivery.service.ts` | `POST …/submit` | Attempt | exam-engine.test, trigger | – | keep |
| Grading | MCQ auto-grade, negative marking, regrade, key actions (drop/accept) | VERIFIED_COMPLETE | `results.service.ts` | `/results/*` | Result, KeyAction | workflow.test | – | keep |
| Grading | Subjective/manual grading + feedback | MISSING | – | – | – | – | **H** | brief lists it; no question type, no UI |
| Results | Lecturer review → examiner approve → CCE publish, open-incident block | VERIFIED_COMPLETE | `results.service.ts` | `/results/batches/*` | ResultBatch | workflow.test | – | keep |
| Results | Result versions / correction history | PARTIAL (audit log only) | – | – | – | – | M | add ResultRevision |
| Results | Student results + performance analytics | PARTIAL | `results`, `performance` pages | `/me/results` | Result | e2e | L | |
| Certificates | Record, serial, public masked verification | VERIFIED_COMPLETE | `verify/page.tsx` | `/public/verify` | Certificate | workflow.test | – | |
| Certificates | PDF generation | MISSING | `certificate/[id]` is HTML print | – | – | – | M | |
| Invigilation | Live monitor (poll), extend, force-submit, incidents | PARTIAL | `monitor/*`, `incidents` | `/monitor/*`,`/incidents` | Attempt, Incident | workflow.test, e2e staff | M | polling not push; no exam-wide pause; tab-switch columns absent in UI |
| Reports | Dashboards, exam report, CSV (formula-injection guard) | PARTIAL | `reports.service.ts` | `/reports/*` | – | security.test | M | institution-wise analytics shallow |
| Audit | Hash-chained log, verify, list UI | VERIFIED_COMPLETE | `audit.service.ts` | `/audit` | AuditLog | security.test | – | add external anchoring |
| Notifications | In-app + outbox email | PARTIAL | `notifications/` | `/notifications` | Notification, OutboundMessage | workflow.test | L | SMS missing; real SMTP untested |
| Settings | System settings / feature toggles | MISSING | – | – | – | – | M | |
| Search | Global ⌘K search | MISSING | – | – | – | – | L | |
| Ops | Docker Compose stack | NOT_VERIFIED | `docker-compose.yml` | – | – | none | M | run on a Docker host |
| Ops | CI pipeline | NOT_VERIFIED | `.github/workflows/ci.yml` | – | – | never run | M | commit & run |
| Ops | Backup/restore, metrics, alerts | MISSING | – | – | – | – | **H** | |

**Count (39 rows, tallied from the Status column by first token):** VERIFIED_COMPLETE 16 · PARTIAL 11 · MISSING 10 · NOT_VERIFIED 2 · BROKEN 0 · UI_ONLY 0 · MOCK 0. Two VERIFIED rows carry caveats in-cell. No row is UI-only: every page calls a real endpoint. Scoring is by row, unweighted, and only a coarse map — it is not a progress percentage and rows are not equal in effort.
