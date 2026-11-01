# 03 — Global navigation forensic audit

Evidence: 7 role crawls (menu extracted from the DOM), click-through of every menu item, active-state and back-button tests, keyboard traversal (14 tab stops/page), 8 viewports. Source: `apps/web/src/nav.ts`, `(app)/layout.tsx`.

## 1. Shell inventory

| Element | Present? | Observation |
|---|---|---|
| Left sidebar (role label, up to 11 items, campus code at foot) | yes ≥ 1024 px | active item set with `aria-current="page"`; follows sub-routes (`/exams/:id/control` keeps "Examinations", `/monitor/:id` keeps "Live monitor") |
| Drawer + "☰ Menu" button | yes < 1024 px | closes on navigation, Escape, scrim; focus not trapped (UI-013 pattern) |
| Top bar: breadcrumb "Role › Page", Notifications bell, user name, Sign out | yes | breadcrumb is **blank** on routes without a menu item (`Student ›` on /programs, /certificate) — UI-021 |
| Profile menu / role switching | none | user name is plain text; "My profile" is a menu item. Role switching not applicable (one role per user) |
| Institution / campus switcher | none | campus appears only as small text at the foot of the sidebar (`DMC-A`) — UI-050; users with two campuses (possible) have no switcher |
| Global search | none | per-list search only (reference deck has a global search box) — UI-050 |
| Page tabs / secondary nav | none | exam record, control centre and monitor are linked by header buttons (good) |
| Quick actions | dashboard tiles (links) | tiles look like statistics, not links (no affordance) — UI-023 |
| Footer / help links | none | no help, policy or contact link anywhere except on the login page text |
| Skip link | none | UI-009 |

## 2. Menu by role and where each item really goes

| Role | Menu label → destination page title | Verdict |
|---|---|---|
| **Student** | Dashboard · Exam schedule · Results · Performance · My profile | clear; Results/Performance are separate but small (see §4) |
| **Lecturer** | Dashboard · Question bank · Examinations · Students · My profile | **no "My courses", no grading, no materials** (UI-035); "Examinations" opens a page whose subtitle says "Build papers, approve, schedule, monitor and publish." |
| **Examiner** | Dashboard · **Question review → "Question bank"** · **Schedule & approve → "Examinations"** · Live monitor · Incidents · My profile | label ≠ title twice (UI-021); no Students/Institutions entries although both pages render for this role (UI-022) |
| **CCE** | Dashboard · **Papers & results → "Examinations"** · Live monitor · Incidents · **Eligibility → /enrolment (crash)** · Audit trail · My profile | "Papers & results" hides scheduling and control; "Eligibility" lands on the error card (UI-001); Question bank, Students reachable but absent |
| **Campus Admin** | Dashboard · Students · **Enrolment & eligibility (crash)** · Lecturer assignments · **Staff & accounts** · Examinations · Incidents · Audit trail · My profile | **no Live monitor** (UI-006); "Staff & accounts" lists 40 students (UI-024); 9 items, 3 of which are near-synonyms (Students / Staff & accounts / Enrolment) |
| **Invigilator** | Dashboard · Live monitor · Incidents · My profile | shortest and clearest menu; dashboard has no CTA to Live monitor (UI-023) |
| **Super Admin** | Dashboard · Institutions · Programs & courses · Lecturer assignments · **Users** · Students · Examinations · Live monitor · Incidents · Audit trail · My profile | 11 items; **no Question bank** though the page renders (UI-022); "Users" = Campus Admin's "Staff & accounts" (same page, two names) |

## 3. The 15 navigation questions, answered for the whole app

1. **Label immediately understandable?** Mostly yes for single-noun items (Dashboard, Incidents, Audit trail). No for "Question review", "Schedule & approve", "Papers & results", "Eligibility", "Staff & accounts".
2. **Label matches destination?** 5 mismatches (table in doc 21, UI-021).
3. **Destination matches expectation?** "Eligibility" and "Enrolment & eligibility" promise attendance/eligibility management and show a crash.
4. **Under the correct parent?** Menus are flat (no groups); every role has ≤ 11 items so grouping is not yet necessary.
5. **Duplicates?** Students / Staff & accounts; Users / Staff & accounts; Examinations / Papers & results / Schedule & approve (one page).
6. **Too deeply nested?** No — maximum depth is menu → list → record → control (3 levels).
7. **Visible to the correct role?** Not consistently: hidden-but-reachable routes (UI-022) and a missing monitor entry (UI-006).
8. **Leads to a real functional page?** 54 of 55 distinct menu entries do; `/enrolment` crashes.
9. **Active state correct?** Yes on all tested routes; none on non-menu routes.
10. **Placement consistent?** Yes — identical shell on every authenticated page.
11. **Clear route back?** Breadcrumb is not clickable; "Go to dashboard" appears only on error pages; the exam record ↔ control ↔ monitor header buttons are good. Back button works but list state is lost (UI-028).
12. **Works on mobile?** Yes after the shell fix (drawer verified at 360–1023 px).
13. **Keyboard possible?** Yes; but no skip link and 7–11 stops before content (UI-009).
14. **Cognitive load?** Low (short menus); raised by label drift and hidden routes.
15. **First-time user can predict?** For Student and Invigilator yes; for Examiner/CCE/Campus Admin no.

## 4. Results vs Performance, Exams vs Schedule (checked, not assumed)

- **Results / Performance (student):** different content (row list with certificate vs aggregates/chart) and different labels; the earlier suspicion that they "overlap confusingly" is **not supported by observation**. They are both small; merging into one "Results" page with two sections is a *recommendation* (doc 23), not a defect. One real inconsistency: an "Absent" row appears in Results but Performance says "No published results yet" (UI-042).
- **Examinations vs Exam schedule:** student "Exam schedule" and staff "Examinations" are different pages for different tasks; no confusion observed.

## 5. Notification links (tested)

Student: 2 distinct targets sampled (/results, /schedule) → correct, current. Examiner: "Results ready for review" → `/results` → "This page is for candidates." (dead-end, UI-031); "Question awaiting review" → /questions ✓. Lecturer: "Question approved" → /questions ✓. The six dead links of the previous audit were **not reproduced**.

## 6. Proposed label changes (CURRENT → PROPOSED, reason, destination)

| Current | Proposed | Reason | Destination |
|---|---|---|---|
| Question review (Examiner) | Question bank | matches the page title; examiners also curate, not only review | /questions |
| Schedule & approve (Examiner) / Papers & results (CCE) | Examinations | one page, one name; actions are inside | /exams |
| Eligibility (CCE) / Enrolment & eligibility (Campus Admin) | Attendance & eligibility | the page's task is attendance → eligibility; "Enrolment" is secondary | /enrolment (after UI-001 fix) |
| Staff & accounts (Campus Admin) / Users (Super Admin) | Staff accounts (default filter = staff) | students are not staff; Super Admin keeps "All users" | /users |
| Lecturer assignments | Lecturer course assignments | matches page title | /assignments |
| Live monitor (all) | Live exams | the page first lists exams, then monitors one; "Live monitor" suggests a single screen | /monitor |
| Go to schedule (student dashboard button) | Start exam / View schedule | direct action (UI-007) | /exam/:id or /schedule |
| Starts in (schedule column) | Opens in / Closes in (status-aware) | UI-008 | — |
| End (monitor row) | End attempt… | UI-029 | confirmation |
| + Time | Add time | UI-029 | dialog |
| Report | Report incident | UI-029 | incident dialog |
| Close (confirm button in "Close examination") | End examination | UI-030 | — |
| Reconcile attempts | Seal overdue attempts | jargon | — |
| Initiate scoring | Start marking | jargon | — |
