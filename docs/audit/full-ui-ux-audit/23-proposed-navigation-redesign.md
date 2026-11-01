# 23 — Proposed navigation redesign (NOT implemented)

Principles: one name per concept; menu label = page title = breadcrumb; each role's landing page answers "what needs me now?"; time-critical tools (live monitor) never hidden; read-only reference pages reachable from where they are used instead of by URL; no new visual styles. Each proposal below solves an observed problem (issue IDs).

## Shared shell changes (all roles)
- Skip link, per-page titles (UI-009/010); breadcrumb shows the real page and its parent and is clickable; a **context chip** in the top bar for scoped roles ("DMC-A · Demo Medical College A"; two-campus users get a switcher) (UI-050); global search only where it saves clicks (exams/students/questions) — optional, phase 2; help link in the footer; mobile: existing drawer.
- Notifications grouped by type with a visible total and role-aware links (UI-031).

## STUDENT — landing: Dashboard (Live-now card first)
Primary: **Dashboard · Exams (schedule + instructions) · Results (results, performance, certificates)** · Profile & security.
- Merge Results + Performance into one "Results" page with a Performance section (recommendation, low priority: both pages are small).
- Quick action: "Start exam" when one is live. Mobile: bottom bar with the same three items (optional).
- Keep exam player as a separate chrome.

## LECTURER — landing: My courses
Primary: **My courses** (assigned courses with question counts and review status) · **Question bank** · **Papers** (read-only list of exams for my courses) · Grading (when built) · Profile.
- Remove "Students at campus" tile; remove "Examinations" subtitle that promises scheduling (UI-035/049).

## EXAMINER — landing: Needs my attention
Primary: **Needs attention** (questions to review, papers to build/schedule, live exams, results to approve — list, not tiles) · **Question bank** (rename from "Question review") · **Examinations** (rename from "Schedule & approve") · **Live exams** · Incidents · Profile.
- Quick action: "+ New examination"; read-only link to Students/Institutions via record pages, not menu.

## CONTROLLER (CCE) — landing: Live and pending
Primary: **Dashboard** (live exam cards with online/disconnected, then papers/results) · **Examinations** · **Live exams** · Incidents · **Attendance & eligibility** (UI-001 fixed) · Results & certificates · Audit trail · Profile.
- Add Students and Question bank as secondary links under Examinations/Eligibility, matching reachable pages (UI-022).

## CAMPUS ADMIN — landing: Today at my campus
Primary: **Today** (live exam at my campus with present/absent, incidents, students below attendance) · **Live exams** (**added**, UI-006) · **Students** (with record pages: attendance, eligibility, attempts, UI-034) · Attendance & eligibility · Examinations (campus timetable) · Incidents · **Staff accounts** (staff only) · Lecturer assignments · Audit trail · Profile.
- Rename "Staff & accounts" → "Staff accounts"; students' accounts handled from the student record (UI-024).

## INSTITUTION ADMIN (role does not exist today)
If introduced: same as Campus Admin plus Departments/Programmes/Sessions for their institution; no university-wide tools. Not designed further until the role is approved.

## INVIGILATOR — landing: Live exams
Primary: **Live exams** (assigned exam cards with a "Monitor" button) · Incidents · Profile — **drop the separate Dashboard** (tiles carry no action) or make it the same list (UI-023).

## SUPER ADMIN — landing: System overview
Primary: **Overview** (health, alerts, live exams) · **Institutions** (list + edit + admins) · **Users & roles** (all users, role matrix) · Programmes & courses · Examinations · Live exams · Incidents · Audit trail · Settings (when built) · Profile.
- Question bank link added (UI-022); "Users" keeps all accounts, filter default "Staff".

## What stays, what moves
| Keep | Rename | Move | Combine | Remove | Missing (add) |
|---|---|---|---|---|---|
| shell, active states, drawer, role menus, header buttons between exam record / control / monitor, dashboard deep-links | Question review, Schedule & approve, Papers & results, Eligibility, Staff & accounts, Live monitor | Programs & courses under Academic; monitor into Campus Admin menu | Results + Performance (student); Dashboard + Live exams (invigilator) | "Go to schedule" button; duplicate Sign out in profile | My courses, student record, attendance register, permissions/settings pages, context chip, help |
