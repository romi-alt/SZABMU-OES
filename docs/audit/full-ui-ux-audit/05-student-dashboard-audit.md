# 05 — Student portal: dashboard, schedule, instructions

Accounts used: student.a004 (no attempts), student.a002 (published pass), student.a001 (ineligible). Evidence in `evidence/student/`.

## A. Dashboard (`/dashboard`) — `s01-dashboard-desktop.jpg`, `s19-dashboard-after-results.jpg`
| Question | Answer |
|---|---|
| Next exam immediately visible? | Yes — "Next examination" card under the tiles |
| Date/time quick to identify? | **No — it shows "Opens 01 Nov 2026 13:27", a past time, for an exam that is live now (UI-007)** |
| Status understandable? | Not on this page — no status chip |
| "Start Exam" obvious? | **No — the only button is "Go to schedule"; starting takes 3 clicks (schedule → Start → Begin examination)** |
| Eligibility clear? | No — an excluded student sees "Upcoming exams 0" (UI-051) |
| Pending actions visible? | None exist besides exams |
| Completed exams separated? | The tile "Completed 1 — Published results" counts results, not sittings |
| Overloaded with statistics? | No — 4 small tiles; sparse (page ≈ 70 % empty) |
| Performance metrics useful here? | Average score / Passed duplicate the Performance page; acceptable |
| Each card has a purpose? | yes |
| Quick actions correct? | "View exam schedule" and "Go to schedule" duplicate each other |
| Institution/programme shown? | Yes: "MBBS · Semester 4 · Reg. DMC-A-2024-0004"; campus code in sidebar foot |

Misleading data: "Upcoming exams 3" counts exams that are already live; "Average score —" for no results is acceptable.

## B. Exam schedule (`/schedule`) — `s02-schedule-desktop.jpg`
Columns: Code, Subject (title + course/semester), Opens, Closes, Duration, Questions, Status, Starts in, action.
- Upcoming vs completed: **not separated** — a Published exam sits in the same table with "Starts in 00:58:34" and "Locked" (UI-008).
- Date/time: two-line "01 Nov 2026 / 13:27" — clear; durations in "min"; question count shown (helpful).
- **Status vs "Starts in" contradictions** for manually controlled exams (UI-008).
- Missing: venue/mode, exam type, eligibility state, link to instructions before starting, search/filter (4 rows today), explicit unavailable states (what does "Locked" mean?).
- Start/Resume behaviour: "Start →" for LIVE; "Resume →" when an attempt exists; receipt code displayed after submission (good).
- Empty state for excluded student: "No examinations are scheduled for you yet." (UI-051).
Can students understand what is happening today and next? Partly — the status chips are clear; the countdown column is not trustworthy.

## C. Instructions (`/exam/:id`) — `s03-exam-entry-100q.jpg`
Five bullets: one best answer + negative-marking rule (**dynamic**: verified in source — the earlier suspicion that it is hard-coded is refuted), server-controlled countdown, autosave meaning of "Saved", don't open a second window, review before submit + receipt. Readable, short, no scrolling. Missing: device/network guidance, how skip/mark/palette work (only shown inside the player), maximum time and question count are in the title line only. One confirmation (a single "Begin examination →"); no checkbox — appropriate. A non-yet-open exam shows a yellow "Opens …" notice and a disabled Begin button (also for a Published exam — confusing copy, UI-008).
Unnecessary steps before entering: the dashboard → schedule hop (UI-007). Reload during an exam returns here and needs "Resume" (UI-040).

## D. Student profile (`/profile`) — `s20-profile-invalid-phone-saved.jpg`
Read-only fields ("Managed by your institution": full name, email, reg no., programme, institution) vs editable (phone, address, emergency contact, date of birth). Password rules shown ("At least 10 characters; three of lower / upper / digit / symbol") with a 4-segment strength meter; "Update password" disabled until valid. Findings: phone "abc" saved with "Profile saved" (UI-032), two Sign out buttons (UI-032), MFA card shown to students? (not shown for students — good; staff see "Set up two-factor authentication").
