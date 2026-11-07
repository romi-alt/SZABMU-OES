> Evidence file for `docs/audits/SZABMU-OES-INFRASTRUCTURE-AND-AI-READINESS-AUDIT.md` (2026-11-07). Produced by static, read-only code review; nothing was executed. Each finding is tagged VERIFIED (code read at the cited line) or ASSUMPTION. Findings in the main report marked "re-checked" were additionally confirmed by the lead auditor.

# Audit: Domain workflows and AI-readiness (SZABMU OES)

Scope: read-only static review of /home/user/SZABMU-OES (apps/api, apps/web, packages/shared, docs). No server started, no DB touched, no secrets read.
Tags: VERIFIED = confirmed by reading the cited code. ASSUMPTION = inferred, not executed.
Line counts are for `.ts` files inside each folder (apps/api/src/modules/*).

## Summary of findings

| ID | Sev | Title |
|---|---|---|
| DOM-01 | MEDIUM | Admin/lecturer/examiner question path cannot set topic, subtopic, bloom, image, marks or pool (only the teacher path can) |
| DOM-02 | MEDIUM | Teacher DRAFT questions and answer keys are readable by examiners/CCE/lecturers via GET /questions, contradicting the "drafts stay private" design |
| DOM-03 | MEDIUM | No syllabus, learning-outcome or learning-material data exists in the system (curriculum = external URLs only); topic is free text |
| DOM-04 | MEDIUM | Roster "claimed" tracking is dead: `claimedAt` is never written, UI reports "0 of N have registered" |
| DOM-05 | LOW | Student sign-up accepts any unclaimed registration number without matching the official register (identity squatting; mitigated by selfDeclared verification) |
| DOM-06 | LOW | Dead / unreachable API routes (no web caller): notification broadcast, departments, directory reassign-students, reports/institutions, grading queue |
| DOM-07 | LOW | Two parallel faculty models (LECTURER vs TEACHER) and two question-authoring implementations with divergent validation |
| DOM-08 | LOW | S3/object-storage config and `@aws-sdk/client-s3` dependency are unused; all files are DB BLOBs |
| DOM-09 | LOW | Notifications are in-app only; e-mail is used solely for OTP/reset codes. No result, approval, or schedule e-mail; no SMS |
| DOM-10 | LOW | Deterministic quality tools (item-writing checks, duplicate detection) are not offered to the TEACHER portal, where most authoring happens |
| DOM-11 | LOW | Documentation drift: README/architecture say PostgreSQL (code is MySQL/MariaDB); implementation-status says 2FA not implemented (it is) |
| DOM-12 | INFORMATIONAL | docs/ai claims match the code: no AI/LLM footprint exists |
| DOM-13 | INFORMATIONAL | Frozen paper snapshot omits topic/bloom/difficulty and question version; analysis is per-exam and not persisted |
| DOM-14 | INFORMATIONAL | Audit chain serialises all writers on one row lock; unsuitable as a high-volume AI prompt/response log |

Counts: CRITICAL 0, HIGH 0, MEDIUM 4, LOW 7, INFORMATIONAL 3.

---

## Findings

### DOM-01 MEDIUM - Question metadata unavailable on the admin/lecturer/examiner path [VERIFIED]
- File: apps/api/src/modules/exams/exams.controller.ts:10-14 (`questionDto`) and apps/web/src/app/(app)/questions/page.tsx (no `topic|bloom|tags|subtopic` token anywhere in the 118-line file).
- Evidence: `questionDto` has courseId, type, vignette, stem, explanation, difficulty, tags, options only. `QuestionInput` (questions.service.ts:12-29) supports topic/subtopic/bloom/imageId/defaultMarks/poolId, but zod strips unknown keys so POST/PUT /questions can never set them. The web form does not send `tags` either, so `Question.tags` (schema.prisma:597) is effectively never populated.
- Impact: questions authored by LECTURER/EXAMINER/seed have `topic`, `bloom` NULL and `tags` []. Only teacher-portal questions (pools page, teachers.controller.ts:19-22 `mcq`) carry topic/bloom. Any topic/blueprint/AI feature sees a bank that is inconsistently labelled by author role. PUT also resets topic to null (questions.service.ts:125 `topic: d.topic ?? null`), so an examiner editing a teacher question erases its topic.
- Recommendation: extend `questionDto` and the web form with topic/subtopic/bloom/marks (or route all authoring through one service/DTO). Do not null `topic` on update when the field is absent.

### DOM-02 MEDIUM - Teacher drafts and keys are visible to other roles [VERIFIED]
- Files: apps/api/src/modules/exams/questions.service.ts:60-73 (`list`), :54-58 (`load`), :35 (`get`); contrast apps/api/src/modules/teachers/bank-review.service.ts:14 ("Drafts stay private to their author").
- Evidence: `list`/`get` filter only by institution scope and `access.questionWhere`. For EXAMINER/CCE/SUPER_ADMIN `pairs()` returns null, so `{}`: no status or author filter. `list` returns `correct` (key) per question. For LECTURER the filter is course+institution, not author, so a lecturer assigned to the same course sees a teacher's DRAFT questions and keys. `authorOnly` (line 38) is applied only to update/submit/retire.
- Impact: the bank-review UI hides drafts, but the same data leaks through GET /questions and GET /questions/:id; breaks the author-privacy intent and widens exposure of unreviewed (and, for AI planning, confidential) content.
- Recommendation: decide the policy. If drafts of other authors must be private, add `OR: [{status: {not: 'DRAFT'}}, {authorId: u.id}]` to list/get for non-owners.

### DOM-03 MEDIUM - No syllabus / learning-outcome / material data [VERIFIED]
- Files: apps/api/prisma/schema.prisma:396-415 (`Course`: code, title, semester, credits, isDemo only), :1494-1508 (`CurriculumDocument`: title, url, appliesTo, versionLabel, programId only), apps/api/src/directory/curriculum-links.ts:1-6 (header: "A located document is NOT a curriculum entered into the system").
- Evidence: no table or field for learning outcomes, objectives, topics hierarchy, blueprint, syllabus text, or learning materials. `CurriculumDocument` rows are links to PDFs on www.szabmu.edu.pk, linked to Program (not Course), content never fetched or stored. `Question.topic`/`subtopic` are free text VarChar(191) with no controlled vocabulary or FK to a topic table; the teacher topic list is only the author's own distinct topics (teacher.service.ts:305).
- Impact: any feature that must ground itself in curriculum (AI drafting from syllabus, blueprint coverage) has nothing structured to read. Topics will fragment ("Cardiology"/"cardiology "/"CVS").
- Recommendation: introduce Course-level Topic/LearningOutcome tables and a document-ingestion path before AI work; normalise `Question.topic` to it.

### DOM-04 MEDIUM - Roster "claimed" feature is dead [VERIFIED]
- Files: apps/api/src/modules/auth/registration.service.ts:122-127 (reads `claimedAt`), :24-30 (doc: "sign-up no longer consumes it"); apps/web/src/app/(app)/roster/page.tsx:114,118 (Status filter claimed/unclaimed, text "{claimed} of {total} on this list have registered").
- Evidence: grep for `claimedAt` across apps/api/src shows only reads in `listRoster`; no write exists since sign-up stopped matching the register. `RosterEntry` rows only influence `trusted` in onboarding.service.ts:68.
- Impact: administrators see "0 of N have registered" regardless of reality; filter "claimed" always empty. Misleading, and the register no longer links to the student record.
- Recommendation: set `claimedAt` when a signup with a matching regNo completes the profile (onboarding.service.ts:77-80), or remove the UI.

### DOM-05 LOW - Self-registration does not check the official register [VERIFIED]
- Files: registration.service.ts:44-50, 78-87; onboarding.service.ts:67-68, 77.
- Evidence: any unused string matching `REG_NO` is accepted and reserved; roster_entries is not consulted. A squatter can reserve a real student's number; the real student is told to contact the exam office (line 80/87 messages). Mitigation: the Student is `selfDeclared`, excluded from enrolment/admission (delivery.service.ts:117) until an administrator verifies (org.service.ts:272).
- Impact: support burden and denial of a real student's self-service; no data exposure.
- Recommendation: surface roster match in the verification queue; allow admin to release a squatted regNo.

### DOM-06 LOW - Routes with no caller in apps/web [VERIFIED, caller search over apps/web/src]
- POST notifications/broadcast (reports.controller.ts:45-52; role enum omits TEACHER/EXAMINER/CCE though permission `notification.send` includes EXAMINER/CCE). docs/implementation-status.md:40 admits "No broadcast UI".
- GET/POST institutions/:id/departments (org.controller.ts:40-41; audit action `department.create`).
- POST directory/reassign-students (directory.controller.ts:16,29) - implemented and audited as `student.reassigned`, no UI.
- GET reports/institutions (reports.controller.ts:20-22) and GET grading/exams (results.controller.ts:14) - no web usage found.
- Also `QUEUES.results` (infra/queues.service.ts:6) is defined, never used.
- Impact: untested-by-UI attack surface and drift. Recommendation: either wire UI or remove/flag.

### DOM-07 LOW - Duplicate role model and duplicate authoring code [VERIFIED]
- LECTURER (admin-created, auto-APPROVED assignments, UI /assignments, course-access.service.ts:68-104 filters `user.role='LECTURER'`) versus TEACHER (self-registered, PENDING->APPROVED, UI /teachers, /classes). Both share `course_assignments`.
- Two question DTOs: exams.controller.ts:12 stem min 10 / 2000 max, options max 1000; teachers.controller.ts:20 stem min 3, options max 500. Teacher import (teacher.service.ts:416-420) writes `tx.question.create` directly, bypassing `QuestionsService.create` (but does write QuestionVersion and audit).
- `term` is enforced for teachers in TeacherService (teacher.service.ts:98-100, 175-178) but ignored by `CourseAccessService.allows/questionWhere` (course-access.service.ts:26-47), so the same teacher has different term-scoping depending on which service answers.
- Impact: inconsistent validation and scoping; harder to retrofit one governance layer. Recommendation: converge on one authoring service and one scoping function.

### DOM-08 LOW - Object storage not implemented [VERIFIED]
- config.ts:19-23 (S3_*), apps/api/package.json:22 (`@aws-sdk/client-s3`), docker-compose.yml minio; no import of client-s3 anywhere in apps/api/src. docs/implementation-status.md:43 admits this.
- All files live in DB: `TeacherProfile.photo` (schema.prisma:1249), `Student.photo` (:545), `QuestionImage.data` LONGBLOB (:1293). Limits: profile photo 200 KB (teacher-registration.service.ts:17), question image 1 MB PNG/JPEG/WebP only, magic-byte checked, SVG refused (teacher.service.ts:19-31); Fastify bodyLimit 2 MB (bootstrap.ts:12); images travel as base64 JSON, not multipart.
- No learning-material, syllabus or document upload exists. Impact: no place to store AI source documents; large blobs inflate DB and backups.

### DOM-09 LOW - Notifications in-app only [VERIFIED]
- notifications.service.ts (30 lines) writes `notifications` rows; the controller routes live in reports.controller.ts:40-44 (misplaced module). MailService (infra/mail.service.ts) is called from only three places: student registration OTP (registration.service.ts:57), teacher registration OTP (teacher-registration.service.ts:116), password reset (auth.service.ts:140). No SMS/push anywhere (grep for sms/whatsapp/twilio: none).
- Teacher approval/rejection, student verification, paper approval, results publication produce in-app notifications only. Impact: users who do not sign in never learn of decisions. Recommendation: decide channel policy.

### DOM-10 LOW - Authoring aids not shown to teachers [VERIFIED]
- `itemWritingChecks` is imported only in apps/web/src/app/(app)/questions/page.tsx:5,11; the pools page (teacher authoring, 269 lines) has none. `GET /questions/duplicates` requires `question.read` (exams.controller.ts:32), which TEACHER lacks (permissions.ts:25). Docs (AI_IMPLEMENTATION_STATUS.md) describe the aids as Verified, which is true for the lecturer/examiner page only.

### DOM-11 LOW - Documentation drift [VERIFIED]
- README.md:10,16,42 and docs/architecture.md:5,10 say PostgreSQL 16; schema.prisma:1,11 is MySQL/MariaDB, migrations are MySQL, docker-compose uses mariadb.
- docs/implementation-status.md:24 says "2FA not implemented (P-04)" but modules/auth/mfa.service.ts (129 lines) and routes auth.controller.ts:56-68 exist. The teacher portal is absent from implementation-status.md.
- Impact: misleads reviewers/operators. Recommendation: refresh docs.

### DOM-12 INFORMATIONAL - docs/ai matches code [VERIFIED]
- docs/ai/AI_IMPLEMENTATION_STATUS.md claims: no provider, no credentials, no data sent to any model; F5 item statistics, F2a duplicate detection, F2b-rules item-writing (7 rules) built. Verified: packages/shared/src/{psychometrics,similarity,item-writing}.ts exist, 7 CheckIds (item-writing.ts:8), test files named in the table exist (apps/api/test/item-statistics.test.ts, question-duplicates.test.ts, tests/e2e/*.spec.ts), item analysis wired at results.service.ts:64-97, duplicates at questions.service.ts:81-91. Not executed, so pass counts and the "4 of 127 flagged" claim are ASSUMPTION.
- docs/ai/AI_GOVERNANCE_AND_PRIVACY.md is a plan ("to be implemented with the first LLM feature"); none of its technical controls (flags, AI audit records, rate limits) exist yet - consistent with its own wording.

### DOM-13 INFORMATIONAL - Snapshot and analytics gaps for AI/learning analytics [VERIFIED]
- exams.service.ts:132 freezes only `type, vignette, stem, options` (no explanation, topic, bloom, difficulty, question version) into `ExamQuestion.snapshot`; `ExamQuestion` has no version column (schema.prisma:722-738). Linking back relies on the mutable live `Question` row (QuestionVersion history exists by questionId+version, but the paper does not record which version).
- Item statistics are computed on demand per exam (results.service.ts:64-97) and not persisted per question; `Question.usedCount` (exams.service:134) is the only cross-exam counter; `Question.difficulty` is author-declared, never reconciled with observed p-value.

### DOM-14 INFORMATIONAL - Audit chain is a serialisation point [VERIFIED]
- audit.service.ts:46-58: every append takes `SELECT ... FROM app_locks WHERE name='audit_chain' FOR UPDATE` and reads the last hash. All audited writes in the system queue on this lock. AI calls (potentially many, long-latency) must not hold it; log AI usage in a dedicated table and write only decision/approval events to the chain.

---

## Module inventory (module, purpose, lines, status)

All "modules" are folders; there is ONE flat Nest `AppModule` (apps/api/src/app.module.ts) with every controller/provider listed.

| Module (apps/api/src/...) | Purpose | Lines | Status |
|---|---|---|---|
| modules/auth | login, MFA/TOTP, reset, student sign-up, onboarding, roster import | 694 | Working; roster claim dead (DOM-04) |
| modules/teachers | teacher sign-up, workspace, pools, question bank review, admin approvals | 1034 | Working end to end |
| modules/org | institutions, programmes/courses, users, students, enrolments, lecturer course access | 538 (+ controllers) | Working; departments routes dead |
| modules/exams | question bank, papers, exam create/schedule/cancel, roster versions, overrides | 521 | Working |
| modules/control | live exam control, lifecycle reconciler, monitor, events | 1232 | Working (out of my scope) |
| modules/delivery | student sit/answers/heartbeat/submit/receipt | 511 | Working |
| modules/results | grading, item analysis, key actions, approval, publish, certificates | 240 | Working |
| modules/invigilation | live monitor, incidents | 155 | Working |
| modules/reports | dashboard, exam report + CSV, audit list/verify, notification + broadcast routes | 191 | Partial (broadcast/institutions unused; notification routes misplaced here) |
| modules/notifications | in-app notification service only (no controller) | 30 | In-app only |
| modules/audit | hash-chained audit log | 73 | Working |
| modules/directory | institution/programme directory (admin API) | 221 | Working; reassign-students has no UI |
| directory/ (src/directory) | CLI importer, baseline dataset, rules, curriculum links | 848 | Working; one network fetch in `cli.ts:30` (`--live`, szabmu.edu.pk) |
| modules/jobs.service.ts, cron/reconcile.ts, worker.ts | queue consumers (grade, mail), outbox sweep, reconcile backstop | 46 + - | Working; QUEUES.results unused |
| infra/mail.service.ts | nodemailer SMTP with DB outbox | - | OTP/reset only |
| infra/queues, kv, metrics | BullMQ or in-process queue, KV (Redis or DB), metrics | - | Working |
| seed/ | demo data | - | Dev only |
| apps/web | ~39 pages (see traces) | pages are short and dense (2348 lines total) | Working |

Placeholders/mocks: none found in production paths; demo data gated by `isDemo` + `DEMO_INSTITUTIONS_VISIBLE` (config.ts:34).

## Workflow traces with verdicts

Permissions are enforced by a global deny-by-default `AuthGuard` (common/auth.ts:118: "Route has no declared permission").

1. Student registration and onboarding - WORKS END TO END (with DOM-04/05).
   web register/page.tsx:36-37 -> POST /auth/register, /auth/register/verify (registration.controller.ts:20-29, session cookie set at :26-27) -> RegistrationService.start/verify (registration.service.ts:36-90; OTP via kv + MailService; `user` role STUDENT + `student_signups` row at :82-83, audit `student.signed_up` :84) -> web complete-profile/page.tsx:19-43 -> GET /onboarding/catalog, POST /onboarding/complete (onboarding.controller.ts:18-19) -> OnboardingService.catalog/complete (onboarding.service.ts:30-87; Student created `selfDeclared: true` :77; admins notified :84-85) -> admin verifies via PATCH /students/:id verify (org.service.ts:267-273) -> delivery blocks unverified (delivery.service.ts:117). Models: User, StudentSignup, Student, UserInstitution, InstitutionProgramOffering, Notification, AuditLog.

2. Teacher registration and academic assignments - WORKS END TO END.
   web register/teacher/page.tsx:53,59 -> GET /teacher-registration/catalog, POST /teacher-registration, /verify (teachers.controller.ts:31-33) -> TeacherRegistrationService (teacher-registration.service.ts:52-156; catalog from directory offerings; assignments validated :77-96; account + TeacherProfile(PENDING) + CourseAssignment(PENDING) in one transaction :136-144; audit `teacher.registered`) -> admin UI teachers/page.tsx -> /admin/teachers/* (teachers.controller.ts:77-85) -> TeacherAdminService decide/suspend/reinstate/decideAssignment/revoke (teacher-admin.service.ts:76-112; sessions dropped; audit `teacher.*`). Teacher workspace: classes/page.tsx, my-students/page.tsx (names only, teacher.service.ts:183-193), submissions/page.tsx. Lecturer path (admin-created): assignments/page.tsx -> POST /course-assignments -> CourseAccessService.assign (course-access.service.ts:68-86); my-courses/page.tsx -> GET /me/course-assignments. Models: User, TeacherProfile, CourseAssignment.

3. Teacher question banks and review (draft -> submitted -> reviewed by examiner) - WORKS END TO END.
   web pools/page.tsx (269 lines) -> /teacher/pools*, /teacher/questions*, /teacher/images (teachers.controller.ts:50-70) -> TeacherService (teacher.service.ts:211-438; createPool :227, submitPool :260 audits `question.submit` per question, importQuestions :401, exportPool :429) delegating to QuestionsService.create/update/submit (questions.service.ts:93-146) -> bank status recomputed by refreshBankStatus (bank-status.ts:15-20) -> examiner web question-banks/page.tsx:review -> POST /question-banks/:id/review (teachers.controller.ts:99) -> BankReviewService.review (bank-review.service.ts:90-131; four-eyes :92, per-question or whole-bank decision, mandatory rejection note, audit `question.approve|reject` + `question_pool.review`, owner notified). Migration 20261106100000 adds `question_pools.status/review*`, `questions.subtopic/bloom/imageId`, `question_images`, append-only `question_versions` with DB triggers. Single-question path for lecturers/examiners: questions/page.tsx -> /questions, /questions/:id/submit|review (exams.controller.ts:27-40).

4. MCQ authoring - WORKS; metadata split by role (DOM-01).
   Fields on `Question`/`QuestionOption` (schema.prisma:588-644): type (MCQ|CLINICAL_MCQ), vignette, stem, explanation, difficulty (EASY|MEDIUM|HARD), tags (Json), topic, subtopic, bloom (6 levels), imageId, defaultMarks, status (DRAFT|SUBMITTED|APPROVED|REJECTED|RETIRED), version, reviewNote/reviewedBy/At, usedCount, poolId; options A-E with one `isCorrect`. Validation: 4-5 options, exactly one correct, distinct (questions.service.ts:40-48). Versions: append-only `question_versions.snapshot` per edit (questions.service.ts:105,121,131). Editing an APPROVED question returns it to DRAFT (:128).

5. Exam creation, paper building, scheduling - WORKS END TO END (manual).
   web exams/page.tsx:post /exams -> ExamsController.createE (exams.controller.ts:45) -> ExamsService.create (exams.service.ts:66); paper: exams/[id]/page.tsx PUT /exams/:id/paper -> setPaper (:85, only APPROVED questions of the course within caller's access); submit -> reviewPaper (:114, four-eyes :117, freezes snapshot + correctLabel :132, increments usedCount :134) -> POST /exams/:id/schedule (:143) -> roster build/versioning (:161-193); control via modules/control. Paper building is manual item picking: no blueprint, no automated selection, no topic/bloom/difficulty coverage check. The student-facing /schedule page is "My Examinations" (exam.sit), not a scheduler. TEACHER role has no paper.build/exam.* permission.

6. Campus and affiliated institution management / directory - WORKS (admin UI), seeded from a verified dataset.
   web institutions/page.tsx (179 lines), programs/page.tsx -> /directory/* (directory.controller.ts:22-29), /institutions, /programs -> DirectoryService/OrgService. Models: Institution, InstitutionProgramOffering, OfferingAllocation, OfferingSession, DirectorySource/Claim, ProgramAlias, AwardingBody, DirectoryImportRun/Change. Affiliation CONSTITUENT|AFFILIATED, intake STOPPED/UNRESTRICTED, shifts, seat allocations. Import is CLI/POST /directory/import with dataset hash. `reassign-students` has no UI (DOM-06). "classes" page is the teacher's class list, not an institution class manager.

7. Notifications - PARTIAL (DOM-09). In-app only; bell in (app)/layout.tsx -> /notifications*. Broadcast has no UI.

8. Reports/exports - WORKS, limited. GET /reports/exams/:id and /csv (reports.controller.ts:18-19; exams/[id]/page.tsx), item analysis, certificates (`certificate_serial_seq`, public /public/verify page), audit page with chain verify. CSV only; no PDF/XLSX server export (web has xlsx-lite.ts client-side). pool export audited (`pool.export`).

9. File uploads - see DOM-08. No multipart; base64 JSON; DB BLOBs; no virus scan (ASSUMPTION: none seen).

10. External integrations - only SMTP (nodemailer, optional; config.ts:24-31), optional Redis/BullMQ, optional S3 (unused), and one operator-run fetch to szabmu.edu.pk in directory/cli.ts:30. No payment, SMS, LDAP, PIMS, analytics or any third-party HTTP client in runtime code (grep fetch/axios/got/undici). Web uses only same-origin `/api` (web/src/api.ts:13).

11. Audit trail - WORKS; used consistently (see "Reusable primitives").

12. Background jobs - grade-attempt and mail queues (jobs.service.ts:28-29), outbox sweep every 15 s without Redis (:33), lifecycle reconciler with DB lease (lifecycle.service.ts), `worker.ts` and `cron/reconcile.ts` entry points. Works; designed for Hostinger managed hosting.

## Existing AI footprint

- Grep of apps/, packages/, infra/, scripts/, docker-compose.yml, .env.example (excluding node_modules, dist, .next, generated) for openai|anthropic|llm|gpt|embedding|vector|gemini: matches were only incidental words ("prompt" in UI strings, "Vector" none, "embedding" none). No AI SDK in any package.json (apps/api/package.json dependencies listed: no openai/anthropic/langchain). No AI env var in config.ts or .env.example. No API keys. No prompts, embeddings, vector store, or model-call code.
- Deterministic "AI-adjacent" features that exist: item statistics (packages/shared/src/psychometrics.ts: p, discrimination d at 27% groups, point-biserial, KR-20, SEM, MIN_CANDIDATES=30), duplicate detection (similarity.ts: word 3-gram Jaccard, threshold 0.6), item-writing rule checks (item-writing.ts, 7 rules).
- docs/ai/*.md (80 lines) match the code: status doc says nothing is configured; governance doc is explicitly forward-looking (DOM-12).

## Data readiness for AI (fields present / missing)

Present:
- Question: stem, vignette (clinical scenario), 4-5 options with single key, explanation, difficulty (author-declared enum), topic/subtopic (free text <=191), bloom (enum, optional, author-set), tags (Json, effectively unused), marks, image (PNG/JPEG/WebP, <=1 MB), version history (append-only snapshots), status/reviewer/reviewNote, usedCount, course + institution + author, pool (bank) with term and name.
- Review outcomes: reviewNote per question and bank (rejection reasons are mandatory) - useful as feedback labels.
- Delivery: `AttemptAnswer.selectedLabel/state/markedForReview/revision/savedAt`; `AnswerEvent` journal (every accepted write with `at`); `Attempt.startedAt/submittedAt/deadlineAt`; `AttemptEvent` (tab/fullscreen/offline); `KeyAction` VOID/CHANGE_KEY with reason (miskey signal); `Result` scores; per-option distribution computed in itemAnalysis (results.service.ts:66-96).
- Org structure: Institution (CONSTITUENT/AFFILIATED), Program, Course (semester, credits), enrolments with term and attendance, CourseAssignment (user, course, institution, term, status).

Missing / weak:
- Syllabus, learning outcomes, objectives, topic taxonomy, learning materials, lecture notes: none (DOM-03). Only `CurriculumDocument` URLs to external PDFs, per Program, content not stored.
- Topic and bloom are optional, free text / author-set, absent on lecturer-path questions (DOM-01); no validation of bloom against content; no controlled vocabulary.
- No empirical difficulty stored per question across exams; psychometrics are per exam and not persisted; paper snapshot lacks topic/bloom/difficulty/version (DOM-13).
- Time per question: only save timestamps (`AnswerEvent.at`), no explicit dwell time; `visited`/`markedForReview` flags exist.
- No per-student historical mastery, no item exposure log beyond `usedCount`.
- Language field absent (English/Urdu unknown) - ASSUMPTION that content is English.
- Real data volume unknown (seed bank cited as 127 questions in docs/ai; not verified).

## Reusable primitives for AI governance

Reusable now:
- Human approval workflow: QuestionStatus DRAFT -> SUBMITTED -> APPROVED/REJECTED (+ bank-level BankStatus), four-eyes enforcement (questions.service.ts:151, bank-review.service.ts:92), mandatory rejection notes, notifications to examiners, append-only `question_versions` (DB triggers refuse UPDATE/DELETE). An AI draft can simply be created as a normal DRAFT question and follow this path unchanged; the governance doc's rule 2 maps directly.
- Permission system: central map packages/shared/src/permissions.ts, `@Perm()` on every route with deny-by-default guard; new permission e.g. `ai.assist` is one line plus a route annotation.
- Config/feature-flag pattern: zod `loadConfig` (config.ts) with `productionProblems` safety gate (config.ts:59) - place for `AI_<FEATURE>_ENABLED`, provider key, and a production check that refuses boot if enabled without approval variables.
- Rate limiting: `KvService.hit(key, ttl)` atomic counters (used for registration at registration.service.ts:38) - reusable for per-user AI quotas.
- Async execution: QueuesService (BullMQ or in-process) and workers for long LLM calls without blocking requests.
- Metrics: infra/metrics.service.ts + /metrics for cost/latency counters.
- Notifications: NotificationsService for "AI draft ready".
- Deterministic pre/post-checks already built: itemWritingChecks and similarPairs can validate/deduplicate AI output before a human sees it.

Not present (must be built): AI service boundary / provider abstraction; any outbound HTTP client wrapper; prompt templates or versioning; AI usage, quota, cost tables; prompt/response logging; suggestion records with accept/edit/reject; `source`/`aiGenerated` provenance field on Question or QuestionVersion (snapshot Json could carry it but no schema field exists); content-safety/prompt-injection handling; kill switch.

Audit naming conventions: `entity.verb_snake` lowercase, dot-separated, entity usually the noun, e.g. `question.submit`, `question.approve`, `question_pool.review`, `pool.export`, `exam.control.initiate_scoring`, `teacher.assignment_approve`, `course.assign`, `auth.login_failed`, `student.profile_completed`. Dynamic forms built from decisions (`question.${decision}`). `AuditEntry` = {actor{id,role}, action, entity, entityId, institutionId, meta JSON, ip} (audit.service.ts:9-17); `append(tx,…)` joins the caller's transaction (:46), `log()` opens its own (:38). Web renders via `auditLabel()` with a readable fallback for unknown codes (web/src/audit-labels.ts:17), so new codes are safe but should get labels. An AI action could be recorded as e.g. `ai.draft_requested` / `ai.suggestion_accepted` / `ai.suggestion_rejected` with entity `question` or `ai_suggestion`, meta {feature, provider, model, promptVersion, inputHash, tokensIn/Out, decision}; never raw confidential text in meta (meta is stored and shown on the audit page). Because of DOM-14, store per-call usage in a dedicated table and chain only decisions.

Teacher scoping for an AI assistant to inherit:
- `CourseAccessService.pairs(u)` (course-access.service.ts:20-33): for TEACHER it re-reads the DB on every call (profile APPROVED, user active, assignment APPROVED and not revoked) and returns [] otherwise (deny by default); for LECTURER, active assignments within institution scope; other roles null (unrestricted within institution scope). Helpers: `questionWhere`, `allows`, `assert`, `assertExam`, `courseIds`.
- TeacherService adds the academic-term constraint (teacher.service.ts:98-100, `questionScope`, `pairOk`) and own-author checks (`ownPool`/`ownQuestion`); `scope.allows/filter/assert` (common/auth) enforce institution isolation.
- An AI endpoint should call `pairs()`/`assert(courseId, institutionId)` before assembling any context, and build context only from rows passing `questionWhere` + term filter, so the assistant can never see another course's or campus's bank. Suspension/revocation take effect immediately (no cached session reliance). Gap: term scoping is not in CourseAccessService (DOM-07) and drafts of other authors are visible to examiners/lecturers (DOM-02), so AI context assembly must apply its own author/status filter.

## Could not verify

- Runtime behaviour of any workflow (no servers started, no DB); verdicts are from static tracing plus cross-checking route <-> web callers by grep.
- Whether test suites pass or the "4 of 127 flagged" statistic in docs/ai is true.
- Whether the web pages' dense one-line code handles all error states (pages are 16-269 lines; only call sites read).
- SMTP delivery against a real relay (docs say untested), Redis vs DB-KV behaviour, production env variable values (.env not read to avoid secrets).
- The contents of seed/content.ts question bank and real data volumes/quality (topic/bloom fill rates in a live DB).
- Whether any web caller for the "dead" routes exists outside apps/web/src (e.g., scripts/tests/e2e call them); tests/ not searched for route usage.
- Antivirus/ content scanning of uploads (none seen in code; infra not inspected).
- Network egress rules/CSP for a future AI provider (web/src/csp.ts and infra not analysed in depth).
