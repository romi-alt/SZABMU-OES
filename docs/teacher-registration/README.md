# Teacher registration and MCQ pool

Status: implemented on branch `claude/oes-platform-foundation`, **not merged and not deployed**. Classification of the product is unchanged (INTERNAL_TESTING_READY). Nothing here has been run against production or the live demo data.

## 1. Audit of the existing system (what was reused, what was missing)

| Area | What exists | Decision |
|---|---|---|
| Authentication | Cookie session, argon2id, lockout, MFA, password policy (`@oes/shared` `checkPassword`), two portals by host | **Reused unchanged.** No second auth system. Teachers sign in through `/auth/login`. |
| Roles / permissions | `Role` enum + central `PERMISSIONS` matrix; every route declares one permission; `route-inventory` test + `docs/route-permissions.md` | Added role **`TEACHER`** and three permissions (`teacher.self`, `teacher.work`, `teacher.manage`). |
| Existing `LECTURER` | Created by admins; authors questions for assigned courses **and reviews grading/results** (`grading.review`, `result.read_scoped`, `student.read`) | **Left exactly as it was.** The brief forbids teachers any result access, so reusing `LECTURER` would have meant removing the lecturer's result review (part of the result pipeline). A separate `TEACHER` role keeps both rules true. |
| Academic model | `Institution`, `Program`, `Course (programId, semester)`, `Enrollment (studentId, courseId, term)`, `Student (institutionId, programId, semester)` | Reused. **There is no class/section table.** A "class" is therefore *institution + programme + semester + academic session (term)*; the subject is the `Course`. No section is invented (see §7). |
| Course assignment | `CourseAssignment (userId, courseId, institutionId, revokedAt)`; `CourseAccessService` restricts questions/papers to active pairs | Extended additively (`status`, `term`, decision fields). Existing rows default to `APPROVED`, so lecturers behave as before; only `APPROVED` rows ever grant access. |
| Question bank | `Question` + `QuestionOption`, DRAFT→SUBMITTED→APPROVED, four-eyes review, version bump on edit, frozen `ExamQuestion.snapshot` | Reused through `QuestionsService`. Added `poolId`, `topic`, `defaultMarks`. Frozen paper snapshots are untouched, so used revisions are preserved. |
| Student self-registration | Redis-held pending record + emailed 6-digit code, identical responses, rate limits | Same pattern reused for teachers. |
| Audit | Hash-chained `AuditLog`, `append(tx, …)` | Every approval, rejection, revoke, suspension, pool action and export is written, in the same transaction as the change where there is one. |
| Notifications | `NotificationsService` + `LINKS` | Admins are notified of new registrations; teachers of decisions. |

## 2. Schema (one additive migration: `20261102175907_teacher_registration_and_pools`)

- `Role` += `TEACHER`; new enums `TeacherStatus` (PENDING, APPROVED, REJECTED, SUSPENDED) and `AssignmentStatus` (PENDING, APPROVED, REJECTED, REVOKED).
- `teacher_profiles` (userId PK, employeeId unique, department, designation, optional photo bytes ≤ 200 KB + mime, status, review fields).
- `question_pools` (owner, course, institution, term, name, description, archivedAt, submittedAt).
- `course_assignments` += `status` (default APPROVED), `term`, `requestedAt`, `decidedById`, `decidedAt`, `decisionNote`; the partial unique index now includes the term and only covers PENDING/APPROVED rows.
- `questions` += `poolId` (nullable), `topic`, `defaultMarks` (default 1).
- No data is changed or deleted by the migration. `prisma migrate diff` against the schema reports no drift.

## 3. Registration flow

1. **Step 1** name, email, password (+ confirm, visibility toggle, strength meter).
2. **Step 2** institution → programme → semester → academic session → subjects (multi-select), repeatable; every option comes from `GET /api/teacher-registration/catalog` (real database); the combinations are listed before continuing. The server re-validates every combination (course belongs to programme and semester, institution active, session exists).
3. **Step 3** faculty ID, department, designation, phone, optional photo (scaled to ≤ 256 px in the browser, re-checked server-side by type, size and magic bytes), review panel, **Submit Registration**.
4. A 6-digit code is emailed; nothing is stored in the database until it is entered. Then **one transaction** creates the user (role TEACHER, no campus scope), the profile (PENDING), one PENDING request per selection and the audit entry. Administrators are notified.

Entered values are kept between steps in memory and across a reload (not passwords, not the photo). The page works at 360 px with a sticky Back/Continue bar.

## 4. Approval and access rules

- A teacher's identity is decided once (approve / reject with reason). **It grants nothing by itself.**
- Each class-subject request is approved or rejected individually (rejection needs a reason). Only `APPROVED` and non-revoked rows give access.
- Access is evaluated from the database on **every request** (not from the cached session): profile APPROVED, account active, assignment APPROVED. Revoking an assignment, suspending a teacher, or a rejection therefore takes effect immediately; suspension also ends the teacher's sessions.
- A teacher whose profile is not APPROVED holds only `teacher.self` (see own status). The UI shows the approval screen instead of the workspace; the API answers `403 TEACHER_NOT_APPROVED` on every working route.
- Campus administrators see and decide only requests naming their own institutions (out-of-scope ids answer 404); super administrators see all.

## 5. Teacher workspace (dashboard.szabmu.site, staff portal)

Overview · My Classes & Subjects · MCQ Pool · Students · My Profile — nothing else.

- **Overview**: four numbers (classes, subjects, MCQs, students), all counted by the API from the caller's approved assignments.
- **My Classes & Subjects**: approved assignments (read-only; changes need an administrator) and the status of any pending/rejected requests.
- **MCQ Pool**: create/rename/delete pools per approved assignment; add, edit, duplicate, preview, delete (retire) MCQs; four options by default, optional fifth; one correct answer; explanation, difficulty, topic, marks; search and filter by status, difficulty, topic; **CSV** import (all-or-nothing, row-numbered errors, template download) and export; "submit pool" sends all draft questions to the examiners (existing review workflow). Questions are also reachable by subject/class through the assignment filter.
- **Students**: names only, searchable. The endpoint selects the name column and nothing else.
- **My Profile**: phone, department, designation, photo; name, email, faculty ID and assignments are shown as text (administrator-managed).

## 6. Security boundary (verified by tests)

- Deny by default: a route without a permission is refused; `TEACHER` holds only `program.read` (the baseline "signed-in user" permission used by `/auth/me`, notifications, own profile), `teacher.self`, `teacher.work`. The test `permission matrix gives TEACHER only…` fails if any other permission is ever added.
- Teachers receive 401/403/404 on results, grading, exams, student records, enrolments, roster, users, institutions, audit, reports, certificates and exam delivery (`teachers.test.ts`, `teachers.spec.ts`).
- IDOR: another teacher's pool, question, assignment, export or student list answers 404; writes are 404 as well.
- Students never receive correct answers (delivery payload test) — unchanged and re-asserted.
- CSV export neutralises spreadsheet formula injection.
- Public endpoints added: `GET /api/teacher-registration/catalog`, `POST /api/teacher-registration`, `POST /api/teacher-registration/verify` (rate-limited per address and per email; the start endpoint answers identically whether or not the email already has an account; the faculty ID uniqueness error is the one deliberate exception). The reviewed public-route inventory and `docs/route-permissions.md` are updated.

## 7. Known limits and decisions that need an owner

1. **No class/section table exists**, so no section is offered. If sections are required they need a model, a way to place students in them, and a data load — a policy/data decision.
2. **XLSX import is not supported** (no spreadsheet library in the repository, and adding one is a supply-chain decision). CSV only; the import dialog says so.
3. **Question pools are submitted per pool, not as a separate approval object:** submitting moves the pool's draft questions into the existing examiner review. There is no pool-level approval state beyond that.
4. **Existing `LECTURER` accounts are unchanged** and still see results/students as before; if the university wants them under the same restrictions that is a separate decision.
5. `defaultMarks` is stored and shown but the paper builder does not yet default to it.
6. Emailing: see §8.

## 8. Hostinger (Enterprise web hosting, no VPS)

Facts are taken from the repository's earlier audits (`docs/deployment/hostinger-managed/01-hosting-capability-audit.md`, evidence-labelled) — **not re-verified against the account in this change, and nothing was deployed**:

- Managed **Node.js** sites (max Node 24), GitHub auto-deploy, environment variables, cron; no Docker, no root, **no permanent background workers**, no PostgreSQL/Redis (Neon + Upstash are used).
- This change needs **nothing new** from the platform: it adds API routes and Next.js pages to the existing build, runs on Node 24, needs no worker, and its migration is applied with `prisma migrate deploy` from a workstation (never from the Hostinger build), exactly as before.
- **Email is the dependency to check before go-live.** The code is sent through the existing outbox. The teacher flow now makes the first delivery attempt inside the request (8 s limit) so it does not depend on a queue worker, but it still needs `SMTP_HOST`/`MAIL_FROM` configured on the site. Without SMTP the code is never delivered (the live demo has `DEV_EXPOSE_CODES=false`).
- Registration is hosted on the student-facing host (`/register/teacher` is on the student portal's allowed list); sign-in and the workspace are on `dashboard.szabmu.site` (staff portal). Cross-links use `NEXT_PUBLIC_STUDENT_PORTAL_URL` / `NEXT_PUBLIC_STAFF_PORTAL_URL` (build-time; defaults `https://oes.szabmu.site` and `https://dashboard.szabmu.site`).

## 9. Deployment steps (for whoever approves them)

1. Merge after review. 2. Apply the migration to Neon from a workstation: `npm run db:migrate` with the production `DATABASE_URL`. 3. Configure SMTP. 4. Let Hostinger's Git auto-deploy rebuild. 5. Create no demo teachers in production; register through the UI. Rolling back the code is safe at any point; the migration is additive and old code ignores the new columns (except that a `TEACHER` role value in the database would be unknown to old code).
