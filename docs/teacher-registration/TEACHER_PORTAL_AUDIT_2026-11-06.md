# Teacher portal — audit against the "complete portal and MCQ bank" brief (2026-11-06)

Status: audit + **Phase 1 (approval logic) done and tested** + **step 1 of the proposed order (Overview figures, Question Submissions, sidebar) done and tested**. The rest of Phases 2–10 below is *not* started; this table says what already exists (verified in code/tests) and what is missing, so the work is not rebuilt.
Product classification unchanged: INTERNAL_TESTING_READY. Nothing deployed; no migration run anywhere but a disposable local database.

## Phase 1 — approval logic (done)

**Cause of the inconsistent screen.** There are two separate decisions: the teacher *account* (`teacher_profiles.status`) and each *class-subject* (`course_assignments.status`). An administrator can approve a class-subject while the account is still PENDING. The server already refused all access in that state (`CourseAccessService.pairs` requires APPROVED account + active user + APPROVED, non-revoked assignment, checked in the database on every call). But the page took its heading from the cached sign-in profile and its table from a fresh call, and showed a bare "approved" badge next to "awaiting approval". After an approval the page also stayed on the old state until the teacher pressed "Check again".

**Fix.**
- `GET /teacher/status` now returns `accountStatus`, `access { accountApproved, activeAssignments }` and, per request, `effective`: `ACTIVE`, `WAITS_FOR_ACCOUNT` (approved subject, account pending), `ACCOUNT_NOT_APPROVED` (approved subject, account rejected/suspended), `PENDING_REVIEW`, `REJECTED`, `REVOKED`. Additive; `status` is unchanged.
- The waiting page uses the fresh server status for its heading, labels each subject by its effective state ("Approved — starts when your account is approved"), re-checks every 15 s and on window focus, and refreshes the profile when it differs — so the workspace and menu appear without signing out.
- Rules stay on the server (unchanged code path, now covered by tests): pending/rejected/suspended/deactivated account → every working route 403 `TEACHER_NOT_APPROVED`; approved account + some approved assignments → only those; pending/rejected/revoked assignment → 404 for its pools/students.

**Tests.** `apps/api/test/teacher-approval-state.test.ts` (4 tests: 3 fail on the old code — missing fields; the deactivation test is a characterization that passed before), `tests/e2e/teacher-approval-live.spec.ts` (fails on the old page with the bare "awaiting approval" text).

## Phases 2–10 — what exists and what is missing

| Brief item | Exists today (verified) | Missing |
|---|---|---|
| **P2 Sidebar** | Overview, My Classes & Subjects, MCQ Pool, Students, My Profile (`nav.ts`) | "Question Submissions" page; rename "MCQ Pool" → "MCQ Question Banks", "Students" → "My Students" (renames touch several e2e specs) |
| **P2 Overview figures** | classes, subjects, MCQs, students — real queries (`TeacherService.overview`) | draft / submitted / approved counts, recent question-bank activity |
| **P3 Banks** | `QuestionPool` (name, description, course, institution, term, archived, submittedAt); MCQs with stem, 2–5 options, one correct, explanation, difficulty, topic, marks; create, edit, duplicate, delete, search/filter, preview, CSV import (all-or-nothing, formula-safe) and export | **Subtopic, Bloom level, image/diagram** (schema columns + upload), Excel (.xlsx) import/export (CSV only today), batch entry |
| **P4 Editor** | modal editor with A–D, correct radio, validation | Save & Add Another, unsaved-changes guard — to be checked in the UI before changing |
| **P5 Review** | Question status DRAFT/SUBMITTED/APPROVED/REJECTED, reviewer note, four-eyes review in the question bank (examiner), teacher edit lock while SUBMITTED, frozen revision in exams | A **bank-level** status and feedback (pool has only `submittedAt`), "return for changes", **version history table** for questions (only an integer `version` today) |
| **P6 My Students** | names only, strictly via APPROVED assignments, search/filter, no detail routes (tested) | nothing found; keep as is |
| **P7 Classes & Subjects** | subject, code, programme, semester, session, institution, student count; approved vs requests | MCQ count per assignment, "open question bank" link, assignment status column wording |
| **P8 Admin/examiner** | admin Teachers page (identity + per-assignment decisions, view of a teacher's pools without answer keys); submitted questions reach the existing examiner review; examiners pick APPROVED questions for papers | dedicated "Teacher Question Banks / Bank Review / Teacher Activity" pages; bank-level approve/reject with comments |
| **P9 Security** | per-call DB check of account + assignment; IDOR → 404; results/grades/exports refused; student paper delivery carries no answer key; audit entries; transaction-safe writes | image upload hardening (type/size/magic bytes) once images exist; indexes for new columns |
| **P10 Tests** | listed in `teachers.test.ts`, `teacher-approval-state.test.ts`, `teachers.spec.ts`, `teacher-approval-live.spec.ts` | tests for each new item above |

## Step 1 — done (no schema change)
- **Sidebar** (exactly six, in this order): Overview, My Classes & Subjects, MCQ Question Banks, My Students, Question Submissions, My Profile. Visible wording "pool" → "question bank" on that page; no results, marks, grades or analytics anywhere.
- **Overview** (`GET /teacher/overview`, additive fields): `questions {draft, submitted, approved, rejected}`, `banks {total, empty, draft, submitted, rejected, approved}`, `recent` (up to 8 events: bank created / sent for review / approved / returned). All from the caller's own banks inside approved assignments. A bank has no status of its own yet, so its state is **derived** from its questions: any under review → submitted; else any returned → rejected; else any draft → draft; else all approved → approved (`bankState`). `GET /teacher/pools` returns that `state`.
- **Question Submissions** (`GET /teacher/submissions`, new route, one `teacher.work` permission; route manifest updated): the caller's questions that left DRAFT, counts per state, state filter, reviewer feedback on returned questions, no options or answer key in the response. Page `/submissions`, with phone-compact rows.
- **Limits, stated plainly:** "recent activity" is built from question timestamps (created / submitted / reviewed), not from the audit log, so it shows the latest submission and latest decision per bank rather than every edit; "returned" = REJECTED (the brief's "return for changes" has no separate state until bank-level review exists, step 4).
- **Tests:** `teacher-overview.test.ts` (2; failed before the code existed), `teacher-portal-overview.spec.ts` (fails on the old UI), `teachers.spec.ts` updated for the new names. API 360/360, shared 77/77.

## Step 2 — migration written and tested locally (NOT deployed, NOT applied anywhere but disposable databases)
File: `apps/api/prisma/migrations/20261106100000_teacher_question_bank_review/migration.sql`. **Review the SQL before any merge to `main`** (merging deploys; `auto-migrate.mjs` then applies it).

| Change | Detail |
|---|---|
| `question_pools` + `status` (DRAFT/SUBMITTED/APPROVED/REJECTED, default DRAFT), `reviewNote`, `reviewedById`, `reviewedAt` | bank-level review state and feedback |
| `questions` + `subtopic`, `bloom` (REMEMBER…CREATE), `imageId` | optional MCQ metadata |
| new `question_images` | image/diagram bytes + mime + size + sha256 (database storage, like profile photos) |
| new `question_versions` | one row per content version; unique (questionId, version); **UPDATE/DELETE refused by triggers**; FK RESTRICT so history cannot be removed with its question |
| 4 indexes | `question_pools(status, institutionId)`, `(ownerId, status)`, `questions(poolId, status)`, `(authorId, status)` |
| 1 data backfill | `question_pools.status` set from each bank's questions (SUBMITTED › REJECTED › DRAFT › APPROVED, else DRAFT); no question row is touched |

**Not included on purpose.** A raw Prisma diff also proposes dropping `course_assignments_active_uniq` and its generated columns, `question_options_one_correct` / `correctFlag`, and adding two unrelated foreign keys. Those are existing hand-written integrity protections that `schema.prisma` does not model; applying a generated diff would remove them. They are left alone (noted in `docs/COORDINATION.md`).

**Verified on disposable MariaDB 10.11:** applied to (a) a database at the previous schema with seeded demo data plus banks in every state — backfill gave SUBMITTED, REJECTED, DRAFT, APPROVED, DRAFT, DRAFT as designed and all 29 existing questions kept NULL in the new columns; (b) an empty database from scratch; `prisma migrate status` clean on both. Triggers refuse UPDATE and DELETE on `question_versions`; duplicate (question, version) refused; deleting a question that has history refused; deleting an image clears the reference. The full API suite (360), lint, typecheck and production build pass on the new schema.

**Rollback.** The change is additive, so the previous application code keeps working on the migrated database (it ignores the new columns/tables). Do not "undo" by dropping columns on a live database; if ever needed, restore from backup (`ROLLBACK_AND_RECOVERY.md`).

**Not yet done:** nothing in the application uses the new columns yet (steps 3–5). **Needs your approval before anything beyond this branch:** merging to `main`.

## Step 3 — editor, image, history and Excel (done; uses the step-2 columns)
- **Fields.** Subtopic, Bloom's level (optional) and an optional image/diagram on every MCQ; searchable subtopic; Bloom and subtopic in the list, preview, duplicate, CSV and Excel import/export.
- **Editor.** Preview (inside the dialog), Save draft, **Save & add another** (saves, opens a fresh form at the statement with topic, subtopic, difficulty, Bloom level and marks carried over, and a running count), Cancel. Enter moves to the next option; Ctrl/Cmd+Enter saves and adds another. The existing dialog guard asks "Discard what you entered?" on Cancel/Escape/backdrop/✕ (a freshly opened blank form closes without asking); closing the tab with unsaved work shows the browser's warning. Clear field errors, "Saving…" states, phone layout, axe scan clean.
- **Images.** `POST /teacher/images` (PNG/JPEG/WebP only — never SVG; real bytes must match the declared type; under 1 MB; stored once per teacher by SHA-256; audited) and `GET /teacher/images/:id` (uploader only; others get 404). A question can only reference an image its author uploaded. **Limit stated plainly: images are kept in the bank and shown to the author and (step 5) reviewers; the student exam player does not display them yet** — that needs a change to the exam delivery code and your decision.
- **History.** Every create (single, import, lecturer) writes version 1; every edit writes the new version, and a question that existed before history gets its earlier content captured on its first edit. Rows are append-only (database triggers). No viewer yet — the history screen belongs to step 4.
- **Excel.** Import `.xlsx` (first sheet; Excel, LibreOffice, openpyxl files tested) and export `.xlsx`, plus CSV and Excel templates. The browser reads the file and sends the same validated rows as a CSV; **the server never parses a spreadsheet**. No new dependency: a small zip/XML reader and writer in `apps/web/src/xlsx-lite.ts` using the browser's built-in compression. Reader limits: 2 MB file, 200 parts, 8 MB per inflated part (zip-bomb guard, tested with a 35 KB file that inflates to 30 MB), encrypted/zip64/unknown formats refused, `.xls` refused with a plain message. Written cells are text, so Excel never treats them as formulas. Bad rows: the server names the row (e.g. "Row 3: Bloom level must be…") and imports nothing.
- **Tests.** API: `teacher-mcq-editor.test.ts` (7, all failed before the code); browser: `teacher-mcq-editor.spec.ts` (5; fails on the old UI) with openpyxl-made fixtures in `tests/e2e/fixtures/` (+ `make-fixtures.py`). Two routes added (both `teacher.work`; manifest updated). Existing specs updated for the renamed buttons. No migration in this step.

## Step 4 — bank-level review workflow (done: API + teacher screens; reviewer screens are step 5)
- **Bank status** (`question_pools.status`, from the step-2 migration) is always set from the bank's questions by one function (`refreshBankStatus`), called by every path that changes a question (create, edit, submit, review, retire, import, bank submit): anything under review → SUBMITTED, else anything returned → REJECTED, else any draft → DRAFT, else all approved → APPROVED (an empty bank is DRAFT). A test asserts stored == implied after each action, so they cannot drift.
- **Read-only while under review.** A SUBMITTED bank refuses add, import, edit, duplicate, delete, rename, single-question submit and a second submit with `409 BANK_LOCKED`; reading and exporting still work. The teacher page shows "Under review — read only" and disables those buttons. Note: submitting even a single question through the old single-question route puts its whole bank under review.
- **Reviewer API** (`question.approve` = Examiner, CCE, Super administrator; no new permission): `GET /question-banks` (queue, oldest first; search by bank or teacher), `GET /question-banks/:id` (questions **with answer keys**, owner, recent history), `GET /question-banks/:id/images/:imageId`, `POST /question-banks/:id/review`. A reviewer sees a bank only once it is submitted (drafts are private; other campuses and unknown ids read as 404). Decide the whole bank (`decision`) or each submitted question (`items`, which must cover every submitted question). Every rejection needs a comment (per question or one for the bank); nobody reviews their own bank. One transaction writes the decisions, the bank state and the audit entries; the teacher is notified ("Question bank approved" / "returned for changes").
- **Teacher feedback.** The bank page shows a banner with the reviewer's comment; each returned question keeps its own comment; Question Submissions lists them. The teacher revises (editing returns a question to draft), submits again — only draft/returned questions go back, approved ones stay approved — and the cycle repeats. The existing single-question review route keeps the bank in step.
- **History and exam use.** `GET /teacher/questions/:id/versions` and a "History" dialog: every version, what changed from the one before, and **which versions an examination paper froze** (matched by content against the paper's frozen snapshot). Editing a question that a paper uses shows a warning first.
- **Design decision to confirm — "approved versions already used in examinations".** An exam paper freezes a copy of the approved question when the paper is approved, and that copy can never change (tested: the frozen text stays). Editing the teacher's question therefore does not alter the exam; it creates a **new version, back in draft, that must be approved again**, and the old version stays in the history marked as used. I did not block editing outright, because that would stop teachers fixing a typo for future exams. If you prefer a hard block (duplicate-then-edit only), it is a small change.
- **Not in this step:** the examiner/administrator screens for the queue, bank review and teacher activity (step 5); showing images to students in an exam.
- **Tests.** API: `teacher-bank-review.test.ts` (8; all failed first); browser: `teacher-bank-review.spec.ts` (fails on the old UI; axe on the locked page and the history dialog). API 375/375, shared 77/77, lint and typecheck clean. Five routes added, each with exactly one existing permission; manifest updated. No migration (uses the step-2 columns).

## Step 5 — examiner and administrator screens (done)
- **Teacher Question Banks** (`/question-banks`; menu item for Examiner, CCE and Super administrator — everyone with `question.approve`; other roles get the standard "no access" page and no menu item). **Queue:** filter Under review / Returned / Approved, search by bank or teacher, "N banks waiting", phone-compact rows, link to the existing submitted-questions list. **Review screen:** teacher (name, designation, department, faculty ID), subject/session/campus, every question with the **answer key highlighted**, clinical scenario, image, explanation, topic › subtopic, Bloom level, marks and version, earlier comments, and the bank's history.
- **Decisions:** per question (Approve / Return for changes, with a required comment unless a whole-bank comment covers it) saved together once every waiting question is decided; or "Approve all N"; or "Return all with a comment…". Progress line ("2 of 3 decided · 1 returned question needs a comment"). After a decision the bank shows the feedback and the teacher is notified; a returned bank reappears in the queue when the teacher resubmits, containing only the resubmitted questions as waiting.
- **Reviewer feedback / activity:** comments are shown on the bank and each question and kept in the audit trail; the bank page has a history list. Administrators (`teacher.manage`: campus administrator, super administrator) get **"View activity history"** in the Teachers page: summary of the teacher's banks and questions by state, and the last 100 entries (bank created/changed/exported, questions created/edited/submitted, images, reviewers' decisions with comments and counts). Campus administrators see only their own institutions; no answer keys, addresses or log hashes. New route `GET /admin/teachers/:userId/activity` (`teacher.manage`; manifest updated).
- **Dashboards.** Examiner and CCE dashboards gain `banksToReview` and an item in "Needs your attention"; examiners get a notification "Question bank awaiting review" that links to the queue.
- **Examinations (no change to the engine).** Verified by test: approved teacher MCQs appear in the examiner's existing paper builder (`GET /questions?status=APPROVED`) and are not selectable before approval; submitting or approving a bank creates no exam and schedules nothing — a paper built from them stays a DRAFT until the examiner submits it and the CCE approves it.
- **Tests.** API: `teacher-bank-admin.test.ts` (3; two failed first, the third characterises the existing exam integration); browser: `question-bank-review.spec.ts` (6, fails on the old UI; axe on the queue, review, activity and phone screens). API 378/378, shared 77/77, lint and typecheck clean. No migration.
- **Not done / for your decision:** "Submitted Questions" is the existing question list filtered to submitted (linked from the queue), not a second screen; images are visible to reviewers but not yet to students in an examination.

## Phase 10 — verification pass (done)
Every item of the brief's test list, with the executed test that proves it (all passing at the end of this pass):

| Brief item | Proof |
|---|---|
| Approval-state transitions | `teacher-approval-state.test.ts` (pending / rejected / suspended / deactivated account × pre-approved, mixed, revoked assignments); `teacher-approval-live.spec.ts` |
| Approved teacher dashboard access | `teacher-overview.test.ts`, `teacher-portal-overview.spec.ts`, `teachers.spec.ts` |
| Pending teacher restrictions | `teachers.test.ts`, `teachers.spec.ts`, and now every working route in `teacher-phase10.test.ts` (route matrix) |
| Creating MCQ banks; adding and editing questions; saving multiple MCQs | `teachers.test.ts`, `teacher-mcq-editor.test.ts`, `teacher-mcq-editor.spec.ts` (Save & add another, Ctrl+Enter, discard guard) |
| Correct answer validation | `teachers.test.ts` (400 on bad key), `teacher-phase10.test.ts` (database refuses two correct options; API refuses none) |
| Bulk import errors | `teachers.test.ts` (all-or-nothing, row named), `teacher-mcq-editor.test.ts` (Bloom/subtopic rows), `teacher-mcq-editor.spec.ts` (Excel: bad Bloom row, zip bomb, non-Excel, .xls) |
| Question submission and review | `teacher-bank-review.test.ts`, `teacher-bank-admin.test.ts`, `teacher-bank-review.spec.ts`, `question-bank-review.spec.ts` |
| Revision history | `teacher-mcq-editor.test.ts` (versions on create/edit/import/legacy, append-only), `teacher-bank-review.test.ts` (history, exam freeze) |
| Student-name-only access | `teachers.test.ts` (names only, by approved assignment); leak scan in `teacher-phase10.test.ts` |
| Cross-subject / cross-teacher / cross-campus / cross-session denial | `teachers.test.ts` (IDOR), `teacher-phase10.test.ts` (**session scoping** and route matrix: foreign ids → 404, other roles → 403, anonymous → 401) |
| Direct API access to results denied | `teachers.test.ts` (every result/grade/exam/report route refused for a teacher); `teacher-phase10.test.ts` (no result/contact fields in any teacher GET) |
| Existing student examination functionality unaffected | full browser suite (exam player, offline, takeover, receipts), API suite (delivery, scoring, failure scenarios), durability fault suite, plus the exam-freeze test |

**Defects found by this pass and fixed (each by a test that failed first):**
1. **Academic-session scoping gap (authorization).** Banks were checked against course + campus + session, but a *question* was checked against course + campus only. If a teacher had two approved sessions of the same subject and one was revoked, the revoked session's questions stayed readable and editable by id, in lists, in Overview counts and in Question Submissions. Fixed: a question is reachable only through the session its bank belongs to (`questionScope`, `ownQuestion`).
2. **Pending teacher got a validation error (400) instead of a refusal (403)** on routes whose body is validated before the service runs (found by the route matrix on `POST /teacher/images`). Fixed centrally: the authentication guard now checks "approved, active teacher" for every `teacher.work` route before any handler or validation. Stricter only; the per-service checks remain.
3. **Phase 7 gaps:** Classes & Subjects lacked MCQ count, bank count, status and the "open question banks" link. Added (`mcqCount`, `bankCount` per approved assignment; link filters the bank list by assignment).
4. **Accessibility:** the new "Open" link first failed axe (label-in-name); fixed before it was committed.

**Pre-existing failures:** none found. Every failure seen during the work was introduced by it and fixed (listed above and in the earlier steps).

**Still open for your decision (unchanged):** images are not shown to students in an examination; whether editing a question that an examination already uses should be hard-blocked; merging to `main` (would apply the step-2 migration on the next deploy — review the SQL first). Not verified here: behaviour on Hostinger (capacity, SMTP, proxy), because everything was run on disposable local databases.

## Proposed order (each step: failing test first, additive migration announced, small commits)
1. Overview figures + Question Submissions page + nav renames (no schema change).
2. Schema (additive): **written and tested locally — see "Step 2" above; awaiting your review before any merge.**
3. Editor: Save & Add Another, unsaved-changes guard, subtopic/Bloom/image fields; Excel import/export. **Done — see "Step 3" above.**
4. Bank-level submit/return/approve/reject and teacher feedback view; version history. **Done — see "Step 4" above.**
5. Admin/examiner pages for banks and teacher activity. **Done — see "Step 5" above.**
