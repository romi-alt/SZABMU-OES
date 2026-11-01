# 19 — Error and edge states

| State | Tested how | Result | Verdict |
|---|---|---|---|
| API 500 on a list | intercepted /api/students | card "Something went wrong on our side… Try again · Go to dashboard", filters still visible | **good** (`x04`) |
| API hang on a list | intercepted /api/exams | 3 skeleton bars for 20 s, no message | UI-033 (`x03`) |
| Unauthorized request | role-mismatched URLs | three inconsistent treatments | UI-018 |
| Expired session | cleared cookies, clicked a link | redirected to /login within 3 s; after re-login lands on /dashboard (not the requested page) | acceptable; return-to-page missing (`x05`) |
| Logged-out deep link | opened /exams/:id | redirected to login; after login → dashboard | same |
| Empty student list / search | searched "zzzz" | "No students." | OK; no echo (UI-028) |
| No scheduled exam | a001 | "No examinations are scheduled for you yet." | UI-051 |
| Exam not yet open / locked | published exam entry | disabled Begin + yellow "Opens …" | confusing for published (UI-008) |
| Exam already submitted | schedule row | receipt code shown, no Start | good |
| Suspended | previous drill | banner + frozen clock | good (HISTORICAL for this audit) |
| Lost internet during exam | offline mode | banner, "N not yet saved", auto recovery | **good** |
| Answer save failure (500) | intercepted PUT | persistent "Not yet saved — retrying", Review blocks 20 s | UI-004 |
| Answer save hang | intercepted PUT | "Saving…" forever | UI-003 |
| Duplicate submission | not exercised (server idempotent per earlier tests) | NOT TESTED in UI | — |
| Missing question image | feature absent | NOT APPLICABLE | — |
| Pending grading | exam in RESULT_PENDING | status chip + results panel | OK |
| Result not published | student a004 before publication | Results empty ("Published results only…") | OK |
| Invalid form input | profile phone | accepted (UI-032); other forms disable the button | UI-026/032 |
| Failed file upload / report export / notification delivery | not exercised | NOT TESTED | — |
| Missing page | /does-not-exist | branded 404 with logo and links; overflows ≈ 2 px at 360/390 | OK + UI-039 |
| Unassigned exam monitor | invigilator | "Exam not found" + "Reconnecting…" | UI-020 |
| Component crash | /enrolment | error boundary with Try again; "Try again" re-crashes | UI-001 |
| Technical detail exposure | all error cards | none shown (no stack traces, no ids) | **good** |
