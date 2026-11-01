# 04 — Information architecture

## 1. Does the sidebar match each role's responsibilities?

| Role | Responsibilities (brief) | What the menu offers | Gap |
|---|---|---|---|
| Student | exams, schedule, results, performance, personal data | all five present | eligibility explanation missing (UI-051); instructions only reachable via Start |
| Lecturer | assigned courses, question authoring, grading, teaching resources | Question bank only | **courses, grading, materials absent** (MISSING REQUIRED UI, UI-035) |
| Examiner | paper preparation, scheduling, live operations, approvals, results | Question review, Schedule & approve, Live monitor, Incidents | results approval lives inside each exam record; no "Needs my approval" entry; control centre read-only for this role (by design) |
| Campus Admin | students, campus exams, attendance, incidents, authorised results | Students, Enrolment (broken), Assignments, Staff, Examinations, Incidents, Audit | **no live monitor, no attendance workflow, no student record** (UI-006, UI-001, UI-034); results only via exam record |
| Super Admin | institutions, users, permissions, platform controls, audit | Institutions, Programs, Assignments, Users, Students, Examinations, Monitor, Incidents, Audit | no Settings, no permissions page, no Question bank entry |
| Invigilator | live monitoring, incidents | Live monitor, Incidents | assigned-exams list is the Live monitor page itself (fine) |

## 2. Redundant or confusing groupings

- **Three pages for one exam**: Examination record (`/exams/:id`), Control centre (`/exams/:id/control`), Live monitor (`/monitor/:id`). Cross-linked by header buttons — *good* — but the monitor is a separate hierarchy (`/monitor` list) so a controller reaches the same exam through two lists with different columns.
- **People management split**: Students (`/students`), Staff & accounts / Users (`/users`), Lecturer assignments (`/assignments`), Enrolment (`/enrolment`) — four routes for "who is part of this campus"; the student record that would join them does not exist (UI-034).
- **Read-only reference pages** (Programs & courses, Institutions) are reachable by almost everyone with no entry point (UI-022).
- **Academic vs operational**: question authoring/paper building/scheduling (academic) and admission/suspension/scoring (operational) both live under "Examinations" → exam record → control centre. The control centre is a separate full page (good), but nothing in the list tells a controller which exams are live and need attention.

## 3. Terminology inconsistencies

| Concept | Names seen | Recommendation |
|---|---|---|
| Campus | "institution" (menu, API), "campus" (tables, monitor, "Your campus only"), "college" (profile: "Demo Medical College A"), "DMC-A" codes | use **Campus** in UI for scoped roles; "Institution" only in Super Admin catalogue |
| Exam | Examination (menu/pages), Exam (buttons), Paper (exam record, "Paper pending"), Test (never) | "Examination" for the event, "Paper" for the question set |
| Inactive institution | "Active" / "Cancelled" (UI-002) | Active / Inactive |
| Candidate | candidate (monitor/control), student (lists), "Candidates" tile (monitor) | candidate in exam context, student elsewhere |
| Not started attempts | "Not started", "Not visited", "Not yet saved" in different screens | keep but define |
| Statuses | exam: DRAFT, PAPER PENDING, APPROVED, SCHEDULED, LIVE, CLOSED, RESULT PENDING, PUBLISHED, CANCELLED; control view adds Admission open, Suspended, Closing, Scoring; student sees "Live" and "Published" | a lifecycle strip with the same names on every role's screens |
| "Completed" | student dashboard tile = published results; staff have no "Completed" | rename student tile "Published results" |

## 4. Dashboards — information shown vs needed

| Role | Shows | Needs | Issue |
|---|---|---|---|
| Student | 4 tiles + "Next examination" | Live-now card with Start; countdown for the next; eligibility messages | UI-007, UI-051 |
| Lecturer | My questions 132 · Results to review 0 · Students at campus 40 · question-pipeline chips | assigned courses; drafts/rejected needing action; "Results to review" has no UI | UI-035, UI-037 |
| Examiner | 4 tiles | list of papers pending/questions awaiting review with links; live exams card | UI-023 |
| CCE | Papers to approve · Results to publish · Open incidents · Live exams (all linked to filtered lists — good deep links) | live exam summary (online/disconnected) | partly good |
| Campus Admin | Students 40 · Accounts 43 · Upcoming exams 3 · Open incidents 0 | live exam at my campus with present/absent counts; students below attendance | UI-023 |
| Invigilator | Assigned 1 · Live now 1 · My open incidents 0 | button "Open live monitor" | UI-023 |
| Super Admin | Institutions 3 · Users 91 · Students 80 · Exams 7 · Audit entries 467 | system health/alerts; "Users" includes students (91 = 11 staff + 80) | minor |

## 5. Missing contextual navigation

No campus switcher or context chip (UI-050); breadcrumbs not clickable; no "back to list" link on records (browser Back loses filters, UI-028); no help.
