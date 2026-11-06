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

## Proposed order (each step: failing test first, additive migration announced, small commits)
1. Overview figures + Question Submissions page + nav renames (no schema change).
2. Schema (additive): **written and tested locally — see "Step 2" above; awaiting your review before any merge.**
3. Editor: Save & Add Another, unsaved-changes guard, subtopic/Bloom/image fields; Excel import/export. **Done — see "Step 3" above.**
4. Bank-level submit/return/approve/reject and teacher feedback view; version history.
5. Admin/examiner pages for banks and teacher activity.
