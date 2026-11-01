# 10 — Campus Administrator portal

Account admin.a (Demo Medical College A). Evidence `evidence/campus/`.

| Reference page / task | Status | Evidence |
|---|---|---|
| Campus dashboard | EXISTING WITH UI ISSUES — 4 tiles: Students 40 · Accounts 43 · Upcoming exams 3 · Open incidents 0; "Upcoming" includes live exams; "Accounts" vs "Students" unexplained (UI-023) | `c01-dashboard.jpg` |
| Registered / verified students | Students page lists 40 with search + CSV import + "+ Add student"; no verified/registered distinction, no per-student page (UI-034) | `c03`, `c06` |
| Eligibility / attendance | **BROKEN FUNCTIONALITY** — "Enrolment & eligibility" crashes (UI-001); exam-day attendance register not modelled (known gap D-07) | `c02-enrolment-crash.jpg` |
| Academic programs | /programs read-only, reachable but not in the menu (UI-022) | — |
| Examination timetable | Examinations list for the campus (7 exams); record page; **no calendar/timetable view** | — |
| Candidate attendance during exams | Live monitor exists but **not in the menu** (UI-006); counts present/online per candidate | `c05` |
| Incidents | Incidents page (empty); reports can be filed from a monitor row | — |
| Campus results | via exam record "Candidate results" table (campus-filtered) — no dedicated "Results" page; published vs awaiting-release is visible as the exam status chip only | — |
| Performance reports | not implemented | — |
| Staff management | "Staff & accounts" mixes staff and 40 student accounts (UI-024) | `c04` |
| Campus settings | not implemented | — |

**Context.** The campus is stated in the dashboard sub-title ("Demo Medical College A (synthetic)"), the Students subtitle ("Scoped to DMC-A") and the sidebar foot — consistent but passive; there is no header chip. University-level versus campus-level numbers are never mixed on campus pages (good), but the monitor says "Your campus only" for everyone (UI-020).

**Registered vs eligible vs admitted vs present:** the control centre and monitor give Allocated / Eligible / Admitted (entered) / In progress / Online — a correct funnel — but Campus Admin has no control-centre access (403 panel "You do not have access to this…", correct) and so only sees the funnel on the monitor.

**Do dashboard statistics lead somewhere?** Yes — tiles are links ("Students" → /students, "Upcoming exams" → /exams), but nothing signals that (UI-023). **Hidden actions:** the UI hides nothing the role cannot use on its own pages but *shows* institution controls it cannot use (UI-019). **Backend enforcement:** every refusal observed came back as HTTP 403 with a generic toast (verified for Register/Deactivate institution as examiner; Campus Admin on /exams/:id/control returned the 403 panel).
