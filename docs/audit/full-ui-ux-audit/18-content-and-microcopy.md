# 18 — Content and microcopy

| # | Location | CURRENT TEXT | ISSUE | RECOMMENDED REPLACEMENT | RATIONALE |
|---|---|---|---|---|---|
| 1 | Student dashboard card | "Opens 01 Nov 2026 13:27" (exam live) | wrong for a live exam | "Live now — closes 08 Nov 13:32" | UI-007 |
| 2 | Student dashboard button | "Go to schedule" | indirect | "Start exam" (live) / "View schedule" | UI-007 |
| 3 | Schedule column | "Starts in 00:58:34" next to "Live" | contradiction | "Closes in …" | UI-008 |
| 4 | Schedule action | "Locked" | unexplained | "Not open yet" / "Closed" | clarity |
| 5 | Excluded student | "No examinations are scheduled for you yet." | hides ineligibility | "You are not eligible for Pathology Mid-term (attendance below 75 %). Contact your campus administrator." | UI-051 |
| 6 | Player button | "Save & next →" | implies manual save | "Next →" | UI-016 |
| 7 | Player | "Clear response" | silent loss | keep + "Answer cleared — Undo" | UI-015 |
| 8 | Review blocked | "Checking that every answer is stored…" (≈ 20 s) then "1 answer(s) could not be stored yet. Check your connection — they will keep retrying. Do not close this window." | long silent wait; "answer(s)" | "1 answer isn't saved yet. Retrying now… [Retry] [Review anyway]" | UI-004 |
| 9 | Permission | "Your role is not permitted to perform this action" | generic; shown as toast and inline | "Only the Controller of Examinations can do this." | UI-018/019 |
| 10 | Permission (page) | "You do not have access to this" (truncated sentence) | looks cut off | "You do not have access to the Question bank." | UI-018 |
| 11 | Staff-only page | "This page is for candidates." | dead end, no heading | "Results are shown to candidates. Staff can view results from the examination record." + link | UI-018/031 |
| 12 | Crash card | "This page hit a problem. An unexpected error stopped this page from displaying. Your saved work is not affected." | reassuring for the exam player, wrong for a page that always fails | keep for unexpected errors; fix UI-001 | |
| 13 | Monitor | "Your campus only." | wrong for university roles | "Showing: all campuses (2)" | UI-020 |
| 14 | Monitor | "Reconnecting — refreshing every 8 s" under "Exam not found" | contradictory | hide on 404 | UI-020 |
| 15 | Monitor rows | "+ Time" / "End" / "Report" | cryptic | "Add time" / "End attempt…" / "Report incident" | UI-029 |
| 16 | Control centre | "Close" (confirm) | same as dismiss | "End examination" | UI-030 |
| 17 | Control centre | "Reconcile attempts" / "Initiate scoring" | jargon | "Seal overdue attempts" / "Start marking" | clarity |
| 18 | Examiner toast | "You cannot approve a paper you submitted (four-eyes principle)" | jargon | "Another approver must approve this paper." | UI-019 |
| 19 | Institutions | "Cancelled" for inactive | wrong word | "Inactive" | UI-002 |
| 20 | Examinations subtitle (all roles) | "Build papers, approve, schedule, monitor and publish." | not true for lecturer/invigilator/campus admin | role-specific subtitle | UI-049 |
| 21 | Audit | "auth.login", "campus_admin", "user ea48217f" | raw codes | "Signed in", "Campus Administrator", "Abbas Mehdi" | UI-038 |
| 22 | Profile | "Profile saved" with phone "abc" | false success | validate | UI-032 |
| 23 | Certificate error | "We could not find that — Certificate not found" + Print button | | "Certificate not found. Certificates are issued for passed examinations." | UI-048 |
| 24 | Login helper | "Accounts lock for 15 minutes after 5 failed attempts." | acceptable; slightly alarming on first sight | move below the button | minor |
| 25 | Profile | "Managed by your institution" (hint under name) | fine; says why read-only | keep | good |
Strengths: control-centre dialogs explain consequences in plain sentences ("Candidates already admitted keep every right…"); the incident dialog names the candidate; offline banner is precise.
