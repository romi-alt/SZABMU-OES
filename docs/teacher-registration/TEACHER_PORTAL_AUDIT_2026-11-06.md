# Teacher portal — audit against the "complete portal and MCQ bank" brief (2026-11-06)

Status: audit + **Phase 1 (approval logic) done and tested**. Phases 2–10 below are *not* started; this table says what already exists (verified in code/tests) and what is missing, so the work is not rebuilt.
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

## Proposed order (each step: failing test first, additive migration announced, small commits)
1. Overview figures + Question Submissions page + nav renames (no schema change).
2. Schema (additive): `questions.subtopic`, `questions.bloom`, image reference; `question_pools.status/reviewNote/reviewedAt/reviewedById`; `question_versions` history. **Needs your approval before the migration is written.**
3. Editor: Save & Add Another, unsaved-changes guard, subtopic/Bloom/image fields; Excel import/export.
4. Bank-level submit/return/approve/reject and teacher feedback view; version history.
5. Admin/examiner pages for banks and teacher activity.
