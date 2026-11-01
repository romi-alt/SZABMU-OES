# UI/UX AUDIT MASTER REPORT — SZABMU/PIMS Online Examination System

_Audit date 2026-11-01 · branch `claude/oes-platform-foundation` @ `7f4c6dd` · read-only audit on a disposable stack with synthetic data · application source unchanged._

**Contents (linked):** [00 coverage & evidence check](00-coverage-and-evidence-check.md) · [01 executive verdict](01-executive-verdict.md) · [02 route & screen inventory + coverage matrix](02-route-and-screen-inventory.md) · [03 global navigation](03-global-navigation-audit.md) · [04 information architecture](04-information-architecture.md) · [05 student dashboard/schedule/instructions](05-student-dashboard-audit.md) · [06 examination player](06-student-examination-player-audit.md) · [07 results & performance](07-student-results-and-performance.md) · [08 lecturer](08-lecturer-portal-audit.md) · [09 examiner/controller/control room](09-examiner-controller-audit.md) · [10 campus admin](10-campus-admin-audit.md) · [11 super admin](11-super-admin-audit.md) · [12 buttons & interactions](12-buttons-and-interactions.md) · [13 user journeys](13-user-journey-analysis.md) · [14 mobile/responsive](14-mobile-responsive-audit.md) · [15 accessibility](15-accessibility-audit.md) · [16 visual design system](16-visual-design-system-audit.md) · [17 forms/tables/search](17-forms-tables-search.md) · [18 microcopy](18-content-and-microcopy.md) · [19 error & edge states](19-error-and-edge-states.md) · [20 cross-role consistency](20-cross-role-consistency.md) · [21 complete issue register](21-complete-issue-register.md) · [22 scorecard](22-ux-scorecard.md) · [23 navigation redesign](23-proposed-navigation-redesign.md) · [24 roadmap](24-prioritized-ui-ux-roadmap.md) · [25 next implementation prompt](25-next-implementation-prompt.md) · raw data `data/` · scripts `tools/` · 84 screenshots `evidence/{student,lecturer,examiner,campus,admin,cross-role,mobile}/`.

## A. EXECUTIVE VERDICT
See [01](01-executive-verdict.md). Strong exam core, uneven surroundings; **52 issues (P0 0 · P1 8 · P2 31 · P3 13)**. Not ready for supervised institutional use until roadmap themes A (data integrity and broken navigation) and B (exam-player failure handling and palette) are done. Previous-audit UI defects: sidebar stacking, error boundaries and favicon are **resolved**; the palette-on-phone item is **partly resolved**; notification volume persists ([21](21-complete-issue-register.md) last table).

## B. OVERALL UX SCORECARD
| # | Area | Score |
|---|---|---|
| 1 | Overall navigation clarity | 6/10 |
| 2 | Information architecture | 5/10 |
| 3 | Student dashboard usability | 5/10 |
| 4 | Student live examination experience | 7/10 |
| 5 | MCQ navigation | 6/10 |
| 6 | Save and status communication | 6/10 |
| 7 | Examination review/submission UX | 7/10 |
| 8 | Lecturer portal usability | 4/10 |
| 9 | Examiner portal usability | 5/10 |
| 10 | Live control room usability | 7/10 |
| 11 | Campus dashboard usability | 3/10 |
| 12 | Super Admin usability | 5/10 |
| 13 | Forms | 5/10 |
| 14 | Data tables | 6/10 |
| 15 | Search and filtering | 4/10 |
| 16 | Mobile responsiveness | 7/10 |
| 17 | Accessibility | 4/10 |
| 18 | Visual consistency | 7/10 |
| 19 | Error and recovery experience | 6/10 |
| 20 | Overall task efficiency | 5/10 |

Full reasoning, evidence and "what is needed for a higher score": [22](22-ux-scorecard.md). Areas not assessable (no evidence): manual grading UI (absent), screen readers, real devices, 200-question palette.

## C. TOP 20 PRIORITY ISSUES
1. **UI-001** (P1) — Enrolment & eligibility: The page renders the error boundary "This page hit a problem" on first load for all 7 roles. → Treat a null path as "not requested" (return loading=true or an `idle` state), make `Async` render nothing/skeleton for data===null, and guard `Table` rows with `rows ?? []`.
2. **UI-002** (P1) — Institutions: Clicking Deactivate on DNC-C (affiliation AFFILIATED) changed the stored affiliation to CONSTITUENT. → Make the update schema a true partial (no defaults) and add a regression test: PATCH {active:false} leaves every other column unchanged.
3. **UI-003** (P1) — Live examination: When a save request never completes (hung connection, captive portal, black-holed packets) the per-question indicator stays on "Saving…" indefinitely (observed 30 s, no change, no banner, no escalation). → Give every save an AbortController timeout (~10 s), treat a timeout as a failed attempt with backoff, and surface the page-level "answers not stored" banner when any answer is unsaved for more than N seconds.
4. **UI-004** (P1) — Live examination → review: With one failing save, "Review & submit" disables itself, shows only a thin "Checking that every answer is stored…" bar for ~20 s (flushAll(20000)), then a message "1 answer(s) could not be stored yet… Do not close this window." The candidate cannot open the review screen, cannot see which question is unsaved, and has no "review anyway" option. → Open the review screen immediately; show per-question sync state in the palette (e.g.
5. **UI-005** (P1) — Live examination (100-question paper): The palette is a 296 × 674 px block that is neither sticky nor independently scrollable. → Make the aside `position: sticky; top: <header height>; max-height: calc(100vh - header); overflow:auto`; add "Go to question #" input and a "next unanswered" button for ≥ 50 questions.
6. **UI-006** (P1) — Primary navigation: The Campus Administrator menu has no "Live monitor" item. → Add { href:"/monitor", label:"Live exams" } to CAMPUS_ADMIN and a "Live now" tile with a link on their dashboard.
7. **UI-007** (P1) — Student dashboard: For an exam that is already LIVE the card says "Opens 01 Nov 2026 13:27" (a past time) and its only action is "Go to schedule"; the schedule then needs "Start →", and the exam page needs "Begin examination →". → Return `availableNow` and `closesAt` from the API; render "Live now" + direct Start link; list all live exams.
8. **UI-008** (P1) — Exam schedule: Three exams show Status "Live" with an enabled "Start →" button AND "Starts in 00:58:34" (a countdown to the planned window). → Compute the column from status: SCHEDULED → "Starts in", LIVE → "Closes in"/"Open", others "—".
9. **UI-051** (P2) — Eligibility feedback: A student excluded for attendance below the threshold (DMC-A-2024-0001) sees "Upcoming exams 0" and "No examinations are scheduled for you yet." The exam URL says only "You are not registered for this examination. → Return excluded exams with a reason code and show them as "Not eligible" rows.
10. **UI-018** (P2) — Permission handling: Opening a page the role may not use gives three different results: a raw API panel under the full page chrome ("You do not have access to this — Your role is not permitted to perform this action") on /questions for students (page title and filters still shown), a dead-end line "This page is for candidates." with no heading on /schedule and /results for staff, and an unexplained crash card on /enrolment (UI-001). → Central route guard from the permission map; one ForbiddenPage component.
11. **UI-019** (P2) — Action visibility: Examiner and Campus Admin see "+ Register institution" and per-row "Deactivate" and get a generic toast "Your role is not permitted to perform this action" (HTTP 403) after clicking; the examiner sees an enabled "Approve paper" for a paper they submitted and is refused with a toast ("four-eyes principle") even though a notice already says so. → Gate by `can(...)`; disable with title for four-eyes.
12. **UI-030** (P2) — Control centre: The close-examination dialog's confirm button is labelled just "Close" and its dismiss ✕ has aria-label "Close": the dangerous action and the dismiss control share a name. → Rename per doc 18; change dismiss aria-label to "Cancel and close dialog".
13. **UI-015** (P2) — Question actions: "Clear response" removes a saved answer with one click, no confirmation, no undo, and sits in the same row as Skip and Mark for review. → Add undo toast for 8 s; move Clear to a secondary position.
14. **UI-013** (P2) — Dialogs: Opening any dialog leaves keyboard focus on the trigger behind the overlay (`focusInside:false` on the submit dialog); no focus trap and no focus return. → Autofocus the dialog heading, trap Tab, restore focus on close.
15. **UI-011** (P2) — Global: axe reports "serious" colour-contrast failures on 154 pages (570 nodes): #8A7A77 on white = 4.09:1 and on ivory = 3.83:1 (needs 4.5:1 at these 9–12 px sizes). → Darken --ink-3 to ≈ #6E5F5C (≥ 4.6:1 on ivory) or move text to --ink-2.
16. **UI-009** (P2) — Global: No skip link on any of 197 audited loads; the first Tab stop on 176 pages is the first sidebar link ("Dashboard"), followed by 6–10 more nav links before the page content. → Add a visually hidden-until-focus link to #main (the main element already has id="main").
17. **UI-017** (P2) — Palette sheet: To reach Q87 on a phone: tap "Questions", swipe the sheet once (390×844) or twice (360×640), tap the number = 3–4 interactions; 54 of 100 buttons visible without scrolling at 390×844, 30 at 360×640. → Add jump-to input and next-unanswered; collapse header to one row (clock + Review).
18. **UI-034** (P2) — Student list: Student rows have no link, button or detail view: a campus admin can search a student (e.g. → Add /students/:id and attendance register (design first).
19. **UI-027** (P2) — Paper builder: Building a paper means ticking checkboxes in an unfiltered list of all approved questions (110 rows, newest first): no search, no difficulty/topic filter, no select-all, no running total of questions/marks, no per-question marks. → Add filters + "select all matching" + totals bar.
20. **UI-020** (P2) — Live monitor: "Live (push). → Derive scope text from `me.institutions`; stop polling on 404.

(All 52 issues with reproduction steps, evidence, source file and acceptance criteria: [21](21-complete-issue-register.md).)

## D. MOST CONFUSING NAVIGATION ITEMS

1. "Question review" (Examiner) → page "Question bank".
2. "Schedule & approve" (Examiner) and "Papers & results" (CCE) → one page titled "Examinations".
3. "Enrolment & eligibility" / "Eligibility" → crashes.
4. Campus Admin menu has no "Live monitor" although the page works.
5. "Staff & accounts" → lists 40 student accounts and exposes Deactivate/Reset password per student.
6. "Users" (Super Admin) = "Staff & accounts" (Campus Admin): same page, two names.
7. Breadcrumb is blank on every route that is not a menu item (Programs, Certificate, Students for Examiner…).
8. Hidden reachable pages: Students/Institutions/Programs for roles without menu entries; Question bank missing for Super Admin/CCE.
9. "Live monitor" opens a list of exams first, then a monitor — "Live exams" is more accurate; the dashboard tile "Live exams 3" already says so.
10. Student dashboard "Go to schedule" is the only way to start an exam from the first screen.

Proposed exact labels: [03 §6](03-global-navigation-audit.md).

## E. STUDENT PORTAL FINDINGS
Dashboard shows a past "Opens" time for a live exam and only "Go to schedule" (UI-007); schedule combines "Live" with "Starts in …" and a countdown on a published exam (UI-008); an ineligible student is told only "No examinations are scheduled for you yet" (UI-051); profile accepts "abc" as a phone number and has two Sign out buttons (UI-032); results/certificate/performance are clear for a passing candidate (doc 07); Absent/Performance mismatch (UI-042). Details [05](05-student-dashboard-audit.md), [07](07-student-results-and-performance.md).

## F. LIVE EXAMINATION PLAYER FINDINGS
Strong: autosave confirmation (56–100 ms), sticky timer/Review, offline banner and auto-recovery, protected submit, keyboard shortcuts, no flashing. Weak: **UI-003** hung save stays "Saving…"; **UI-004** Review & submit locks ≈ 20 s and offers no path when a save fails; **UI-005** palette not sticky — 66–72 of 100 buttons visible at 1280×720 / 1366×768; **UI-012/013/014/015/016** semantics, focus, colour-only states, Clear without undo, "Save & next" wording; phones: 3–4 interactions to jump, 168 px header (**UI-017/036**). 200 questions untested. Full analysis: [06](06-student-examination-player-audit.md).

## G. STAFF AND CAMPUS PORTAL FINDINGS
Enrolment & eligibility crashes for all roles (**UI-001**); institution Deactivate has no confirmation and a PATCH resets affiliation (**UI-002/025**); Campus Admin lacks Live monitor in the menu (**UI-006**), a student record and an attendance workflow (**UI-034**); permission failures shown three different ways and buttons shown that will fail (**UI-018/019**); monitor scope text wrong for university roles (**UI-020**); control-centre labels "Close" ×2 / "End" / jargon (**UI-029/030**); paper builder is a 110-row checklist (**UI-027**); lecturer portal lacks courses/grading/materials (**UI-035**); dashboards are tile-only (**UI-023**); audit trail unreadable for ordinary staff (**UI-038**). Strengths: read-only-with-reason control centre, preview-before-apply, incident dialog, deep-linked CCE tiles. See [08](08-lecturer-portal-audit.md)–[11](11-super-admin-audit.md), [13](13-user-journey-analysis.md).

## H. MOBILE AND ACCESSIBILITY FINDINGS
No authenticated page overflows at 360–1600 px; drawer navigation, card tables and palette sheet work; ≈ 2 px overflow on public pages (UI-039). Accessibility: axe "serious" colour-contrast on 154 of 197 loads (token `--ink-3`, UI-011), no skip link and identical titles on every page (UI-009/010), modal focus (UI-013), palette semantics (UI-012), colour-only states (UI-014), table semantics (UI-043), control borders 1.33:1 (UI-047). All 3,399 controls have names and every focus stop is visible. No assistive-technology test was run. [14](14-mobile-responsive-audit.md), [15](15-accessibility-audit.md).

## I. PROPOSED NAVIGATION STRUCTURE
Per-role trees (Student, Lecturer, Examiner, CCE, Campus Admin, Invigilator, Super Admin; Institution Admin only if the role is created) with landing pages, context chip, renamed labels and what to keep/move/combine/remove: [23](23-proposed-navigation-redesign.md). Not implemented.

## J. PRIORITISED REDESIGN ROADMAP
Ten themes in the order requested, each with issue IDs, source components, dependencies, effort and acceptance tests: [24](24-prioritized-ui-ux-roadmap.md). Quick wins: themes 1–3, 7, 8; architectural: paper builder, student record/attendance, navigation redesign.

## K. READY-TO-EXECUTE IMPLEMENTATION PROMPT
[25](25-next-implementation-prompt.md) — Themes A–D with failing tests first, disposable stack only, one commit per theme.

## Coverage summary (evidence-based)
| Dimension | Inspected | Tested | Not covered | Why |
|---|---|---|---|---|
| Routes | 21 authenticated screen patterns (28–29 route variants) × 7 roles = 197 loads + 4 public | all opened, measured, axe-scanned | /mfa real flow, reset-password step 3, failed-result certificate | MFA off in dev; no such fixture |
| Controls | 3,399 inventoried | ~60 exercised | ~25 data-changing row actions | not needed to prove findings; listed in doc 12 |
| Roles | 7 of 7 | key journeys per role | Campus B user, multi-role users | same role / not available |
| Viewports | 8 on every load | 3 with screenshots; player at 9 sizes | real devices, landscape, 400 % zoom | emulation only |
| Accessibility | axe + manual keyboard + greyscale + computed contrast | player keyboard run | screen readers, voice control | no AT available |
| Evidence | 84 committed screenshots, 173 references, 0 broken | | full crawl images not committed | size; reproducible via `tools/` |
Self-check and corrected claims: [00](00-coverage-and-evidence-check.md).

_Nothing in this report claims WCAG conformance, pilot readiness or production readiness._
