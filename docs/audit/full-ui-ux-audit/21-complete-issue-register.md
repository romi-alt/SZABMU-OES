# 21 — Complete issue register

52 issues: P1 8, P2 31, P3 13. **No P0 was found** in the scenarios tested (no case where a student could not finish an exam, an answer-save falsely reported success, or unauthorised data was shown). Severity follows doc brief Phase 22. Every issue carries confidence and verification status; items marked "recommendation" are design reasoning, not observed defects.

Evidence paths are relative to `docs/audit/full-ui-ux-audit/`. "Observed" = reproduced in a real browser during this audit; "Measured" = scripted measurement; "Automated" = axe-core; "Computed" = calculated from tokens/source.

## Index

| ID | Sev | Role | Route | Title (current behaviour, short) | Category |
|---|---|---|---|---|---|
| [UI-001](#ui-001) | P1 | Campus Admin, CCE (and every role that r | `/enrolment` | Enrolment & eligibility — Page data loading (useGet + Async + Table) | BROKEN FUNCTIONALITY |
| [UI-002](#ui-002) | P1 | Super Admin (data effect visible to all) | `/institutions (PATCH /api/institutions/:` | Institutions — Activate/Deactivate toggle + update DTO | BROKEN FUNCTIONALITY |
| [UI-003](#ui-003) | P1 | Student | `/exam/:id` | Live examination — Save indicator / request layer | MISLEADING FEEDBACK |
| [UI-004](#ui-004) | P1 | Student | `/exam/:id` | Live examination → review — Review & submit / Save & next | BAD WORKFLOW |
| [UI-005](#ui-005) | P1 | Student | `/exam/:id` | Live examination (100-question paper) — Question palette | LAYOUT / NAVIGATION |
| [UI-006](#ui-006) | P1 | Campus Admin | `navigation → /monitor` | Primary navigation — Sidebar (NAV map) | HIDDEN PRIMARY ACTION |
| [UI-007](#ui-007) | P1 | Student | `/dashboard` | Student dashboard — "Next examination" card | MISLEADING STATUS |
| [UI-008](#ui-008) | P1 | Student | `/schedule` | Exam schedule — Status + "Starts in" columns | MISLEADING STATUS |
| [UI-009](#ui-009) | P2 | All | `all authenticated pages` | Global — Skip navigation / tab order | ACCESSIBILITY |
| [UI-010](#ui-010) | P2 | All | `all` | Global — Document title | ACCESSIBILITY |
| [UI-011](#ui-011) | P2 | All | `154 of 197 loads` | Global — Muted text token (--ink-3 #8A7A77) | ACCESSIBILITY |
| [UI-012](#ui-012) | P2 | Student | `/exam/:id` | Question palette — Palette buttons | ACCESSIBILITY |
| [UI-013](#ui-013) | P2 | All | `all modals` | Dialogs — Modal component | ACCESSIBILITY |
| [UI-014](#ui-014) | P2 | Student | `/exam/:id` | Question palette — State legend | ACCESSIBILITY |
| [UI-015](#ui-015) | P2 | Student | `/exam/:id` | Question actions — Clear response | ACCIDENTAL ACTION |
| [UI-016](#ui-016) | P2 | Student | `/exam/:id` | Question actions — Save & next / Skip / Next | LABELLING / COGNITIVE LOAD |
| [UI-017](#ui-017) | P2 | Student (phone) | `/exam/:id` | Palette sheet — Mobile palette | MOBILE USABILITY |
| [UI-018](#ui-018) | P2 | Student, Lecturer, Examiner, Campus Admi | `role-mismatched URLs` | Permission handling — Page shell | INCONSISTENT / MISLEADING |
| [UI-019](#ui-019) | P2 | Examiner, Campus Admin, CCE, Lecturer | `/institutions, /exams/:id` | Action visibility — Buttons shown without permission | MISLEADING AFFORDANCE |
| [UI-020](#ui-020) | P2 | Examiner, CCE, Super Admin | `/monitor/:id` | Live monitor — Subtitle copy | MISLEADING STATUS |
| [UI-021](#ui-021) | P2 | Examiner, CCE | `navigation` | Primary navigation — Labels vs page titles | CONFUSING LABEL |
| [UI-022](#ui-022) | P2 | Examiner, CCE, Lecturer, Invigilator, Ca | `/students, /institutions, /programs, /qu` | Navigation — Routes reachable but not in the menu | HIDDEN FUNCTION |
| [UI-023](#ui-023) | P2 | Examiner, Invigilator, Campus Admin | `/dashboard` | Dashboards — Tile-only dashboards | UNHELPFUL DASHBOARD |
| [UI-024](#ui-024) | P2 | Campus Admin | `/users` | Staff & accounts — Account list | REDUNDANT / DANGEROUS |
| [UI-025](#ui-025) | P2 | Super Admin | `/institutions` | Institutions — Deactivate button | DESTRUCTIVE ACTION WITHOUT CONFIRMATION |
| [UI-026](#ui-026) | P2 | Lecturer, Examiner, Super Admin, Campus  | `/exams, /questions modals` | Forms — Create/Save buttons | FORM UX |
| [UI-027](#ui-027) | P2 | Examiner | `/exams/:id (draft)` | Paper builder — Question picker | TASK EFFICIENCY |
| [UI-028](#ui-028) | P2 | All staff | `list pages` | Search / filter / pagination — List state | STATE LOSS |
| [UI-029](#ui-029) | P2 | Invigilator, Examiner, CCE | `/monitor/:id, /exams/:id/control` | Row actions — "+ Time", "End", "Report" | AMBIGUOUS LABELS |
| [UI-030](#ui-030) | P2 | CCE, Super Admin | `/exams/:id/control` | Control centre — Dialog confirm labels | DANGEROUS AMBIGUITY |
| [UI-031](#ui-031) | P2 | All with bell | `bell panel` | Notifications — Notification panel | INFORMATION OVERLOAD |
| [UI-032](#ui-032) | P2 | Student | `/profile` | Profile — Phone field / validation | MISLEADING SUCCESS |
| [UI-033](#ui-033) | P2 | All staff | `list pages` | Loading states — Async/Loading | MISSING FEEDBACK |
| [UI-034](#ui-034) | P2 | Campus Admin | `/students` | Student list — Row actions / detail | MISSING REQUIRED UI |
| [UI-035](#ui-035) | P2 | Lecturer | `/dashboard, navigation` | Lecturer portal — Menu/dashboard | MISSING REQUIRED UI |
| [UI-036](#ui-036) | P2 | Student (phone) | `/exam/:id` | Exam header — Sticky header | MOBILE USABILITY |
| [UI-037](#ui-037) | P2 | All | `various` | Charts/tiles — aria-pressed on non-interactive chips | ACCESSIBILITY |
| [UI-038](#ui-038) | P2 | Super Admin, CCE, Campus Admin | `/audit` | Audit trail — Table | TECHNICAL JARGON |
| [UI-039](#ui-039) | P3 | All (unauthenticated) | `/login, /forgot, /verify, 404` | Auth pages — Layout at 360–390 px | MOBILE LAYOUT |
| [UI-040](#ui-040) | P3 | Student | `/exam/:id` | Entry — Reload behaviour | EXTRA STEP |
| [UI-041](#ui-041) | P3 | Student | `/exam/:id` | Long clinical stems — Question layout on phones | MOBILE LAYOUT |
| [UI-042](#ui-042) | P3 | Student | `/performance, /results` | Results vs Performance — Consistency | INCONSISTENT DATA |
| [UI-043](#ui-043) | P3 | All | `tables` | Tables — Semantics | ACCESSIBILITY |
| [UI-044](#ui-044) | P3 | All | `all` | Global — Bell accessible name | ACCESSIBILITY |
| [UI-045](#ui-045) | P3 | All | `all` | Global — Landmarks / headings | ACCESSIBILITY |
| [UI-046](#ui-046) | P3 | All | `all` | Design system — Tokens | VISUAL CONSISTENCY |
| [UI-047](#ui-047) | P3 | All | `form controls` | Global — Control boundaries | ACCESSIBILITY |
| [UI-048](#ui-048) | P3 | Student | `/certificate/:id` | Certificate — Error state | MISLEADING AFFORDANCE |
| [UI-049](#ui-049) | P3 | Examiner, Lecturer, CCE | `/exams` | Examinations list — Columns and copy | MINOR CLARITY |
| [UI-050](#ui-050) | P3 | All | `no search / help` | Global chrome — Top bar | MISSING REQUIRED UI |
| [UI-051](#ui-051) | P2 | Student | `/schedule, /dashboard, /exam/:id` | Eligibility feedback — Empty state for an excluded candidate | MISSING FEEDBACK |
| [UI-052](#ui-052) | P3 | Student | `/exam/:id` | Long answer options — Option cards on phones | MOBILE LAYOUT |

## UI-001

**ISSUE ID:** UI-001  
**ROLE:** Campus Admin, CCE (and every role that reaches it)  
**ROUTE:** `/enrolment`  
**SCREEN:** Enrolment & eligibility  
**COMPONENT:** Page data loading (useGet + Async + Table)  
**CATEGORY:** BROKEN FUNCTIONALITY  
**SEVERITY:** P1 — High  

**CURRENT BEHAVIOR:** The page renders the error boundary "This page hit a problem" on first load for all 7 roles. Console: TypeError: Cannot read properties of null (reading 'length'). Browser tests do not cover this route.

**EXPECTED BEHAVIOR:** The page shows the course/term filters and the cohort table (or an empty-state), and lets a campus admin record attendance, enrol a cohort and condone ineligible candidates.

**WHY IT IS CONFUSING / ROOT CAUSE:** `useGet(null)` (api.ts:36-41) returns loading=false, data=null while the course list is still loading; `Async` (ui.tsx:77) then calls children(null) and `Table` reads null.length (enrolment/page.tsx:12-13). The route error boundary catches it, so the page never recovers without "Try again".

**USER IMPACT:** The only UI for attendance entry, bulk enrolment and eligibility condonation is unusable. "Enrolment & eligibility" (Campus Admin) and "Eligibility" (CCE) are primary navigation items. Students and invigilators who guess the URL see "This page hit a problem" instead of a permission message.

**REPRODUCTION STEPS:** Sign in as admin.a → click "Enrolment & eligibility" (or open /enrolment). Observe the error card; console shows the TypeError. Same for cce, super.admin, examiner, lecturer.a, student, invigilator.

**SCREENSHOT EVIDENCE:** `evidence/campus/c02-enrolment-crash.jpg`; `evidence/student/s22-student-enrolment-crash.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/enrolment/page.tsx:12-13; apps/web/src/api.ts:36-41; apps/web/src/ui.tsx:75-79`

**RECOMMENDED FIX:** Treat a null path as "not requested" (return loading=true or an `idle` state), make `Async` render nothing/skeleton for data===null, and guard `Table` rows with `rows ?? []`. Add a permission gate so roles without `enrollment.read` see "You do not have access" rather than an error boundary. Add a Playwright spec that opens /enrolment as Campus Admin.

**ACCEPTANCE CRITERIA:** Opening /enrolment as admin.a renders the filters and a table or "No enrolments…" with zero console errors; as student it shows a permission message; new spec passes.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser (7 roles); root cause traced in source.

---

## UI-002

**ISSUE ID:** UI-002  
**ROLE:** Super Admin (data effect visible to all)  
**ROUTE:** `/institutions (PATCH /api/institutions/:id)`  
**SCREEN:** Institutions  
**COMPONENT:** Activate/Deactivate toggle + update DTO  
**CATEGORY:** BROKEN FUNCTIONALITY (data integrity)  
**SEVERITY:** P1 — High  

**CURRENT BEHAVIOR:** Clicking Deactivate on DNC-C (affiliation AFFILIATED) changed the stored affiliation to CONSTITUENT. Reproduced through the API: PATCH {active:false} → affiliation reset; a city-only PATCH also resets it. The row then shows status "Cancelled".

**EXPECTED BEHAVIOR:** Toggling the active flag changes only `active`. An inactive institution is labelled "Inactive", not "Cancelled".

**WHY IT IS CONFUSING / ROOT CAUSE:** The update DTO inherits the create schema's default for `affiliation` (org.controller.ts:9), so any partial update silently rewrites the field. The page sends only {active} (institutions/page.tsx:15) and the UI shows no sign that another field changed.

**USER IMPACT:** A routine UI action corrupts the constituent/affiliated hierarchy, which drives campus scoping and reporting. Nobody is told.

**REPRODUCTION STEPS:** API: GET /institutions (note DNC-C affiliation) → PATCH /institutions/:id {"active":false} → GET again. UI: Institutions → Deactivate on DNC-C → Affiliation column changes.

**SCREENSHOT EVIDENCE:** `evidence/admin/a03-institution-deactivated-shows-cancelled.jpg`

**SOURCE FILE:** `apps/api/src/modules/org/org.controller.ts:9; apps/web/src/app/(app)/institutions/page.tsx:15`

**RECOMMENDED FIX:** Make the update schema a true partial (no defaults) and add a regression test: PATCH {active:false} leaves every other column unchanged. Replace the "CANCELLED" status token for inactive institutions with "Inactive".

**ACCEPTANCE CRITERIA:** PATCH with a single field changes only that field (API test); UI label reads "Inactive".

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Reproduced twice (UI and API) on a disposable database.

---

## UI-003

**ISSUE ID:** UI-003  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Live examination  
**COMPONENT:** Save indicator / request layer  
**CATEGORY:** MISLEADING FEEDBACK  
**SEVERITY:** P1 — High  

**CURRENT BEHAVIOR:** When a save request never completes (hung connection, captive portal, black-holed packets) the per-question indicator stays on "Saving…" indefinitely (observed 30 s, no change, no banner, no escalation). The request helper has no timeout (api.ts:10 accepts a signal but none is supplied).

**EXPECTED BEHAVIOR:** After a short bounded wait (e.g. 8–10 s) the indicator changes to "Not saved — retrying" and a visible banner appears, exactly as for offline/500.

**WHY IT IS CONFUSING / ROOT CAUSE:** Only the browser `offline` event and non-2xx responses trigger the "not saved" state. A request that neither fails nor succeeds is indistinguishable from "in progress" forever.

**USER IMPACT:** A candidate on a bad network believes the answer is being stored while it may not be; they can leave the question and the final submit then blocks (UI-004). Trust in the one signal students rely on is weakened.

**REPRODUCTION STEPS:** Student a025: open the 100-question paper, intercept PUT /api/attempts/*/answers/* so it never responds, choose an option, wait 30 s.

**SCREENSHOT EVIDENCE:** `evidence/student/s09-player-save-hang-30s-still-saving.jpg`

**SOURCE FILE:** `apps/web/src/api.ts:10; apps/web/src/exam-engine.ts (pump/save path)`

**RECOMMENDED FIX:** Give every save an AbortController timeout (~10 s), treat a timeout as a failed attempt with backoff, and surface the page-level "answers not stored" banner when any answer is unsaved for more than N seconds.

**ACCEPTANCE CRITERIA:** With a never-responding save endpoint the indicator changes from "Saving…" within 12 s and a banner shows the unsaved count; Playwright test with route.hang().

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser at 5 time points.

---

## UI-004

**ISSUE ID:** UI-004  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Live examination → review  
**COMPONENT:** Review & submit / Save & next  
**CATEGORY:** BAD WORKFLOW  
**SEVERITY:** P1 — High  

**CURRENT BEHAVIOR:** With one failing save, "Review & submit" disables itself, shows only a thin "Checking that every answer is stored…" bar for ~20 s (flushAll(20000)), then a message "1 answer(s) could not be stored yet… Do not close this window." The candidate cannot open the review screen, cannot see which question is unsaved, and has no "review anyway" option. "Save & next" blocks for 8 s the same way.

**EXPECTED BEHAVIOR:** The review screen opens immediately, lists the unsaved question(s) with a "Retry now" action, and only the final Submit step is gated.

**WHY IT IS CONFUSING / ROOT CAUSE:** Review is treated as a precondition-check instead of a read-only view; progress feedback is a 12-px status line.

**USER IMPACT:** In the last minutes of an exam on a poor network the student loses ≥ 20 s per attempt and cannot find the problem answer. Time pressure + silent blocking is the exact situation this screen must handle best.

**REPRODUCTION STEPS:** Student a029: intercept PUT answers with HTTP 500; choose an option; click "Review & submit"; poll for 28 s.

**SCREENSHOT EVIDENCE:** `evidence/student/s11-review-and-submit-blocked-during-failed-save.jpg`; `evidence/student/s10-player-save-500-30s-small-indicator-only.jpg`

**SOURCE FILE:** `apps/web/src/app/exam/[examId]/page.tsx:143-146; apps/web/src/exam-engine.ts:124`

**RECOMMENDED FIX:** Open the review screen immediately; show per-question sync state in the palette (e.g. a "!" badge) and a "Retry unsaved answers" button; gate only the final "Confirm and submit".

**ACCEPTANCE CRITERIA:** With failing saves the review screen opens in < 1 s and lists unsaved questions; submit confirm explains the count.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser (HTTP 500 and hang modes).

---

## UI-005

**ISSUE ID:** UI-005  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Live examination (100-question paper)  
**COMPONENT:** Question palette  
**CATEGORY:** LAYOUT / NAVIGATION  
**SEVERITY:** P1 — High  

**CURRENT BEHAVIOR:** The palette is a 296 × 674 px block that is neither sticky nor independently scrollable. Fully visible palette buttons on first screen: 90/100 at 1536×864, 72 at 1366×768, 66 at 1280×720 and 1024×700, 0 at ≤ 960 px (moved to a sheet). The page itself scrolls to reach the rest, taking the question out of view.

**EXPECTED BEHAVIOR:** All question numbers remain reachable without moving the question: palette column sticky with its own scroll (or compact grid) on desktop.

**WHY IT IS CONFUSING / ROOT CAUSE:** Layout is a two-column grid whose right column simply grows with the number of questions.

**USER IMPACT:** On typical laptop screens a student with a 100-item paper must scroll the page to reach questions 67–100 and loses sight of the current question and answer options while doing so.

**REPRODUCTION STEPS:** Student a010/a018/a019: enter the 100-question paper at 1366×768 / 1280×720; count palette buttons fully inside the viewport (script measures them).

**SCREENSHOT EVIDENCE:** `evidence/student/s05-player-100q-1280x720-palette-clipped.jpg`; `evidence/student/s06-player-100q-1024x700-first-screen.jpg`; `evidence/student/s04-player-100q-1440x900-first-screen.jpg`

**SOURCE FILE:** `apps/web/src/app/globals.css (.exam-body, .pal); apps/web/src/app/exam/[examId]/page.tsx:212-224`

**RECOMMENDED FIX:** Make the aside `position: sticky; top: <header height>; max-height: calc(100vh - header); overflow:auto`; add "Go to question #" input and a "next unanswered" button for ≥ 50 questions.

**ACCEPTANCE CRITERIA:** At 1280×720 every palette button is reachable without scrolling the page; Playwright measures the sticky aside.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured in browser at 6 viewport sizes.

---

## UI-006

**ISSUE ID:** UI-006  
**ROLE:** Campus Admin  
**ROUTE:** `navigation → /monitor`  
**SCREEN:** Primary navigation  
**COMPONENT:** Sidebar (NAV map)  
**CATEGORY:** HIDDEN PRIMARY ACTION  
**SEVERITY:** P1 — High  

**CURRENT BEHAVIOR:** The Campus Administrator menu has no "Live monitor" item. /monitor and /monitor/:id render fully for that role, and "Upcoming exams" on the dashboard does not link to it. Reference deck page 23 and the campus-admin task "find a student during an active exam" both depend on it.

**EXPECTED BEHAVIOR:** "Live monitor" is in the Campus Administration menu (and surfaced on the dashboard while an exam at their campus is live).

**WHY IT IS CONFUSING / ROOT CAUSE:** nav.ts defines CAMPUS_ADMIN without the monitor entry while the permission exists.

**USER IMPACT:** The most time-critical exam-day tool is discoverable only by typing a URL.

**REPRODUCTION STEPS:** Sign in as admin.a → inspect sidebar (9 items, no monitor) → open /monitor directly: it works.

**SCREENSHOT EVIDENCE:** `evidence/campus/c05-live-monitor-not-in-navigation.jpg`; `evidence/campus/c01-dashboard.jpg`

**SOURCE FILE:** `apps/web/src/nav.ts (CAMPUS_ADMIN)`

**RECOMMENDED FIX:** Add { href:"/monitor", label:"Live exams" } to CAMPUS_ADMIN and a "Live now" tile with a link on their dashboard.

**ACCEPTANCE CRITERIA:** Campus admin sidebar contains the monitor link and active state highlights it on /monitor/:id.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser; source confirmed.

---

## UI-007

**ISSUE ID:** UI-007  
**ROLE:** Student  
**ROUTE:** `/dashboard`  
**SCREEN:** Student dashboard  
**COMPONENT:** "Next examination" card  
**CATEGORY:** MISLEADING STATUS  
**SEVERITY:** P1 — High  

**CURRENT BEHAVIOR:** For an exam that is already LIVE the card says "Opens 01 Nov 2026 13:27" (a past time) and its only action is "Go to schedule"; the schedule then needs "Start →", and the exam page needs "Begin examination →". Three live exams exist but the card shows one. "Upcoming exams: 3" counts exams that are live.

**EXPECTED BEHAVIOR:** A live exam is labelled "Live now — closes 08 Nov 13:32" with a "Start exam" button that goes straight to the instructions; multiple live exams are listed.

**WHY IT IS CONFUSING / ROOT CAUSE:** The dashboard card renders `d.next.opensAt` unconditionally (dashboard/page.tsx:32) and has no concept of availability.

**USER IMPACT:** The first screen a student sees on exam day gives a wrong time and an indirect action. Students will ask "has it started?".

**REPRODUCTION STEPS:** Sign in as student.a004 with the seeded live exam: read the card; click through to start (3 clicks).

**SCREENSHOT EVIDENCE:** `evidence/student/s01-dashboard-desktop.jpg`; `evidence/student/s02-schedule-desktop.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/dashboard/page.tsx:32`

**RECOMMENDED FIX:** Return `availableNow` and `closesAt` from the API; render "Live now" + direct Start link; list all live exams.

**ACCEPTANCE CRITERIA:** With a live exam the dashboard shows "Live now" and the Start button reaches /exam/:id in one click.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser; source confirmed.

---

## UI-008

**ISSUE ID:** UI-008  
**ROLE:** Student  
**ROUTE:** `/schedule`  
**SCREEN:** Exam schedule  
**COMPONENT:** Status + "Starts in" columns  
**CATEGORY:** MISLEADING STATUS  
**SEVERITY:** P1 — High  

**CURRENT BEHAVIOR:** Three exams show Status "Live" with an enabled "Start →" button AND "Starts in 00:58:34" (a countdown to the planned window). A published exam shows "Starts in 00:58:34" with a locked button. The countdown column ignores manual start/close.

**EXPECTED BEHAVIOR:** Status, availability and timing agree: Live → "Closes in …"; Published/closed → "—".

**WHY IT IS CONFUSING / ROOT CAUSE:** `Countdown to={r.opensAt}` is shown whenever there is no attempt (schedule/page.tsx:29) regardless of status.

**USER IMPACT:** Contradictory signals on the one screen students use to decide whether they may start; erodes trust in MANUAL-control exams.

**REPRODUCTION STEPS:** student.a004 → /schedule with the audit fixtures.

**SCREENSHOT EVIDENCE:** `evidence/student/s02-schedule-desktop.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/schedule/page.tsx:28-30`

**RECOMMENDED FIX:** Compute the column from status: SCHEDULED → "Starts in", LIVE → "Closes in"/"Open", others "—".

**ACCEPTANCE CRITERIA:** No row combines status Live with "Starts in"; unit test over the status matrix.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser; source confirmed.

---

## UI-009

**ISSUE ID:** UI-009  
**ROLE:** All  
**ROUTE:** `all authenticated pages`  
**SCREEN:** Global  
**COMPONENT:** Skip navigation / tab order  
**CATEGORY:** ACCESSIBILITY (WCAG 2.4.1)  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** No skip link on any of 197 audited loads; the first Tab stop on 176 pages is the first sidebar link ("Dashboard"), followed by 6–10 more nav links before the page content.

**EXPECTED BEHAVIOR:** A "Skip to main content" link is the first focusable element and the main landmark has an id target.

**WHY IT IS CONFUSING / ROOT CAUSE:** AppShell renders no skip link (layout.tsx).

**USER IMPACT:** Keyboard and switch users traverse the whole menu on every page.

**REPRODUCTION STEPS:** Load any page, press Tab once; run the crawl data (`tabStops`).

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/app/(app)/layout.tsx`

**RECOMMENDED FIX:** Add a visually hidden-until-focus link to #main (the main element already has id="main").

**ACCEPTANCE CRITERIA:** First Tab stop is "Skip to main content" and Enter moves focus to main.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured across 197 loads.

---

## UI-010

**ISSUE ID:** UI-010  
**ROLE:** All  
**ROUTE:** `all`  
**SCREEN:** Global  
**COMPONENT:** Document title  
**CATEGORY:** ACCESSIBILITY (WCAG 2.4.2) / NAVIGATION  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Every page (197/197 authenticated loads and all public pages) has the title "SZABMU Online Examination System".

**EXPECTED BEHAVIOR:** Titles describe the page: "Question bank — SZABMU OES", "Control centre · Audit — 100-question Pathology Paper".

**WHY IT IS CONFUSING / ROOT CAUSE:** A single static `metadata` export (app/layout.tsx:7); no per-route metadata.

**USER IMPACT:** Tabs, history and screen-reader page announcements are indistinguishable; invigilators with several windows cannot tell them apart.

**REPRODUCTION STEPS:** Read `document.title` on any two routes.

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/app/layout.tsx:7`

**RECOMMENDED FIX:** Add route-level `generateMetadata` or a client `useDocumentTitle` hook from PageHead.

**ACCEPTANCE CRITERIA:** Distinct titles on all routes (automated check).

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured across 197 loads.

---

## UI-011

**ISSUE ID:** UI-011  
**ROLE:** All  
**ROUTE:** `154 of 197 loads`  
**SCREEN:** Global  
**COMPONENT:** Muted text token (--ink-3 #8A7A77)  
**CATEGORY:** ACCESSIBILITY (WCAG 1.4.3)  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** axe reports "serious" colour-contrast failures on 154 pages (570 nodes): #8A7A77 on white = 4.09:1 and on ivory = 3.83:1 (needs 4.5:1 at these 9–12 px sizes). Affected: breadcrumb (every page), stat tile labels, hints, "Opens", empty-state text, timestamps.

**EXPECTED BEHAVIOR:** All text ≥ 4.5:1.

**WHY IT IS CONFUSING / ROOT CAUSE:** One token (`--ink-3`) is used for small text that should use `--ink-2` (7.9:1).

**USER IMPACT:** Low-vision users cannot read breadcrumbs and secondary labels; small print on already small text.

**REPRODUCTION STEPS:** axe-core on any page; computed ratios in doc 16.

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/app/globals.css (:root --ink-3; .crumbs, .faint, .stat .k, .hint, .empty)`

**RECOMMENDED FIX:** Darken --ink-3 to ≈ #6E5F5C (≥ 4.6:1 on ivory) or move text to --ink-2.

**ACCEPTANCE CRITERIA:** axe color-contrast: 0 violations on all routes.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Automated (axe) + computed ratios.

---

## UI-012

**ISSUE ID:** UI-012  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Question palette  
**COMPONENT:** Palette buttons  
**CATEGORY:** ACCESSIBILITY (WCAG 4.1.2, 2.1.1)  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** The 100 palette buttons are `<button role="listitem">`, which removes their button role for assistive technology; each is a separate Tab stop (86 Tab presses from Q1 to Q87; no roving tabindex or arrow-key movement).

**EXPECTED BEHAVIOR:** A grouped set of real buttons (or a listbox with roving tabindex) with a "go to question" shortcut.

**WHY IT IS CONFUSING / ROOT CAUSE:** Role override at page.tsx:218; no keyboard model for the grid.

**USER IMPACT:** Screen-reader users hear list items, not controls; keyboard users cannot reach a distant question efficiently.

**REPRODUCTION STEPS:** Inspect DOM; press Tab from the first palette button until Question 87 is focused (86 presses measured).

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/app/exam/[examId]/page.tsx:218`

**RECOMMENDED FIX:** Remove role="listitem"; wrap in nav/list semantics; add arrow-key roving tabindex and a numeric jump field.

**ACCEPTANCE CRITERIA:** Palette buttons expose role=button; Q87 reachable in ≤ 5 key presses.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured in browser; source confirmed.

---

## UI-013

**ISSUE ID:** UI-013  
**ROLE:** All  
**ROUTE:** `all modals`  
**SCREEN:** Dialogs  
**COMPONENT:** Modal component  
**CATEGORY:** ACCESSIBILITY (WCAG 2.4.3)  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Opening any dialog leaves keyboard focus on the trigger behind the overlay (`focusInside:false` on the submit dialog); no focus trap and no focus return. Escape closes (good).

**EXPECTED BEHAVIOR:** Focus moves to the dialog title/first field, is trapped, and returns to the trigger on close.

**WHY IT IS CONFUSING / ROOT CAUSE:** ui.tsx Modal adds only an Escape listener.

**USER IMPACT:** Keyboard users can Tab into the page behind a "modal" dialog, including in the high-stakes submit confirmation.

**REPRODUCTION STEPS:** Player → Review & submit → Submit examination… → read document.activeElement.

**SCREENSHOT EVIDENCE:** `evidence/student/s13-player-submit-confirm-dialog.jpg`

**SOURCE FILE:** `apps/web/src/ui.tsx (Modal)`

**RECOMMENDED FIX:** Autofocus the dialog heading, trap Tab, restore focus on close.

**ACCEPTANCE CRITERIA:** Automated focus test passes for every modal.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured in browser; source confirmed.

---

## UI-014

**ISSUE ID:** UI-014  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Question palette  
**COMPONENT:** State legend  
**CATEGORY:** ACCESSIBILITY (WCAG 1.4.1)  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** In an achromatopsia (greyscale) emulation "Unanswered" (maroon border) and "Not visited" (rose border) are nearly identical, "Skipped" is only a pale fill, and the legend is colour swatches. Aria-labels do carry the state for screen readers.

**EXPECTED BEHAVIOR:** Each state has a non-colour cue (icon/pattern/text letter).

**WHY IT IS CONFUSING / ROOT CAUSE:** States are colour-only visual encodings.

**USER IMPACT:** Colour-blind students cannot tell what still needs attention.

**REPRODUCTION STEPS:** Chrome DevTools → Rendering → Emulate vision deficiency: achromatopsia; look at the palette.

**SCREENSHOT EVIDENCE:** `evidence/student/s14-palette-greyscale-states.jpg`

**SOURCE FILE:** `apps/web/src/app/globals.css (.pal button.*)`

**RECOMMENDED FIX:** Add glyphs (✓, –, !, ⚑) to palette buttons and legend.

**ACCEPTANCE CRITERIA:** All five states distinguishable in greyscale.

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Manually verified with emulation (partial: no user study).

---

## UI-015

**ISSUE ID:** UI-015  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Question actions  
**COMPONENT:** Clear response  
**CATEGORY:** ACCIDENTAL ACTION  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** "Clear response" removes a saved answer with one click, no confirmation, no undo, and sits in the same row as Skip and Mark for review.

**EXPECTED BEHAVIOR:** Undo toast ("Answer cleared — Undo") or confirmation when clearing a saved answer.

**WHY IT IS CONFUSING / ROOT CAUSE:** Action is immediate and synced.

**USER IMPACT:** A mis-tap on a phone erases an answer; the student must notice and re-choose.

**REPRODUCTION STEPS:** Choose an option → click Clear response → no dialog (dialogShown 0).

**SCREENSHOT EVIDENCE:** `evidence/student/s07-player-after-clear-response-no-confirmation.jpg`

**SOURCE FILE:** `apps/web/src/app/exam/[examId]/page.tsx:203`

**RECOMMENDED FIX:** Add undo toast for 8 s; move Clear to a secondary position.

**ACCEPTANCE CRITERIA:** Clearing shows undo; undo restores and re-saves the answer.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser.

---

## UI-016

**ISSUE ID:** UI-016  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Question actions  
**COMPONENT:** Save & next / Skip / Next  
**CATEGORY:** LABELLING / COGNITIVE LOAD  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Four similar controls: "Skip question", "Save & next →", "Next →", palette. Answers autosave, yet the primary button says "Save & next" (blocks 8 s while saving). "Next" without answering marks the question "unanswered" while "Skip" marks it "skipped" – the review screen then reports Skipped / Unanswered / Not visited as three separate counts.

**EXPECTED BEHAVIOR:** Two navigation actions (Previous/Next) plus an optional Mark; "Skipped" and "Unanswered" are merged ("Not answered").

**WHY IT IS CONFUSING / ROOT CAUSE:** Distinct engine states leak into the UI.

**USER IMPACT:** Students must learn a vocabulary during the exam; "Save" implies manual saving is required.

**REPRODUCTION STEPS:** Q1 answer → Next → Next → Skip → inspect palette aria-labels: answered / unanswered / skipped.

**SCREENSHOT EVIDENCE:** `evidence/student/s12-player-review-100q.jpg`

**SOURCE FILE:** `apps/web/src/app/exam/[examId]/page.tsx:200-206`

**RECOMMENDED FIX:** Rename to "Next →" (primary) and drop "Save &"; merge states in UI copy; keep Skip only if policy requires.

**ACCEPTANCE CRITERIA:** Review screen shows "Not answered (n)" and "Marked (n)" only.

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Observed in browser; design recommendation on the label.

---

## UI-017

**ISSUE ID:** UI-017  
**ROLE:** Student (phone)  
**ROUTE:** `/exam/:id`  
**SCREEN:** Palette sheet  
**COMPONENT:** Mobile palette  
**CATEGORY:** MOBILE USABILITY  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** To reach Q87 on a phone: tap "Questions", swipe the sheet once (390×844) or twice (360×640), tap the number = 3–4 interactions; 54 of 100 buttons visible without scrolling at 390×844, 30 at 360×640. The sticky header uses 168 px (20% of 844, 26% of 640).

**EXPECTED BEHAVIOR:** A numeric "Go to question" field and a "Next unanswered" shortcut; header ≤ 15% of viewport.

**WHY IT IS CONFUSING / ROOT CAUSE:** Same grid reused in a sheet; header stacks logo/title/clock/buttons.

**USER IMPACT:** Slower navigation under time pressure; less room for the question on small phones.

**REPRODUCTION STEPS:** Student a021/a022: open the sheet and measure scrollHeight vs clientHeight (script).

**SCREENSHOT EVIDENCE:** `evidence/mobile/m03-player-390x844-palette-sheet.jpg`; `evidence/mobile/m04-player-360x640-palette-sheet.jpg`

**SOURCE FILE:** `apps/web/src/app/globals.css (.pal-aside, .exam-bar)`

**RECOMMENDED FIX:** Add jump-to input and next-unanswered; collapse header to one row (clock + Review).

**ACCEPTANCE CRITERIA:** ≤ 2 interactions to any question; header ≤ 15% at 360×640.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured on 3 viewports.

---

## UI-018

**ISSUE ID:** UI-018  
**ROLE:** Student, Lecturer, Examiner, Campus Admin, Invigilator, CCE, Super Admin  
**ROUTE:** `role-mismatched URLs`  
**SCREEN:** Permission handling  
**COMPONENT:** Page shell  
**CATEGORY:** INCONSISTENT / MISLEADING  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Opening a page the role may not use gives three different results: a raw API panel under the full page chrome ("You do not have access to this — Your role is not permitted to perform this action") on /questions for students (page title and filters still shown), a dead-end line "This page is for candidates." with no heading on /schedule and /results for staff, and an unexplained crash card on /enrolment (UI-001). The staff view of /exam/:id is bare text with no navigation at all.

**EXPECTED BEHAVIOR:** One pattern: a 403 page naming the page and the roles that can use it, with a link home.

**WHY IT IS CONFUSING / ROOT CAUSE:** Pages fetch first and render errors; some check role in the component, some not.

**USER IMPACT:** Users cannot tell "not permitted" from "broken".

**REPRODUCTION STEPS:** Student → /questions, /enrolment; staff → /schedule, /results; super.admin → /exam/:id.

**SCREENSHOT EVIDENCE:** `evidence/student/s21-student-opens-question-bank-url.jpg`; `evidence/lecturer/l04-schedule-dead-end.jpg`; `evidence/cross-role/x07-staff-opens-exam-player-url.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/*/page.tsx; apps/web/src/app/exam/[examId]/page.tsx`

**RECOMMENDED FIX:** Central route guard from the permission map; one ForbiddenPage component.

**ACCEPTANCE CRITERIA:** Every restricted route shows the same 403 page; no restricted page issues data requests (62 console 403s today).

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed across 7 roles.

---

## UI-019

**ISSUE ID:** UI-019  
**ROLE:** Examiner, Campus Admin, CCE, Lecturer  
**ROUTE:** `/institutions, /exams/:id`  
**SCREEN:** Action visibility  
**COMPONENT:** Buttons shown without permission  
**CATEGORY:** MISLEADING AFFORDANCE  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Examiner and Campus Admin see "+ Register institution" and per-row "Deactivate" and get a generic toast "Your role is not permitted to perform this action" (HTTP 403) after clicking; the examiner sees an enabled "Approve paper" for a paper they submitted and is refused with a toast ("four-eyes principle") even though a notice already says so.

**EXPECTED BEHAVIOR:** Controls the role cannot use are hidden, or disabled with the reason.

**WHY IT IS CONFUSING / ROOT CAUSE:** Visibility is not driven by `can()` on these pages.

**USER IMPACT:** Trial-and-error, and the server-refused action looks like a bug.

**REPRODUCTION STEPS:** examiner → /institutions → Deactivate; /exams/<own paper> → Approve paper.

**SCREENSHOT EVIDENCE:** `evidence/examiner/e06-institutions-admin-buttons-for-examiner.jpg`; `evidence/examiner/e07-register-institution-403.jpg`; `evidence/examiner/e11-approve-own-paper-refused.jpg`; `evidence/campus/c07-institutions-admin-buttons-for-campus-admin.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/institutions/page.tsx; apps/web/src/app/(app)/exams/[id]/page.tsx`

**RECOMMENDED FIX:** Gate by `can(...)`; disable with title for four-eyes.

**ACCEPTANCE CRITERIA:** No 403 reachable from a visible enabled button for any role.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Clicked in browser.

---

## UI-020

**ISSUE ID:** UI-020  
**ROLE:** Examiner, CCE, Super Admin  
**ROUTE:** `/monitor/:id`  
**SCREEN:** Live monitor  
**COMPONENT:** Subtitle copy  
**CATEGORY:** MISLEADING STATUS  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** "Live (push). Your campus only." is shown to university-wide roles viewing 78 candidates from two campuses; for an unassigned exam the page shows "Reconnecting — refreshing every 8 s" under a permanent "Exam not found" error and keeps polling a 404.

**EXPECTED BEHAVIOR:** Scope text matches the viewer ("All campuses (2)" / "DMC-A only"); an error stops the "reconnecting" message.

**WHY IT IS CONFUSING / ROOT CAUSE:** Static strings in monitor/[examId]/page.tsx.

**USER IMPACT:** A controller cannot trust which candidates the table represents.

**REPRODUCTION STEPS:** examiner → Live monitor → open exam; invigilator.a → /monitor/<unassigned id>.

**SCREENSHOT EVIDENCE:** `evidence/examiner/e09-monitor-your-campus-only.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/monitor/[examId]/page.tsx`

**RECOMMENDED FIX:** Derive scope text from `me.institutions`; stop polling on 404.

**ACCEPTANCE CRITERIA:** Subtitle shows the actual scope.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser.

---

## UI-021

**ISSUE ID:** UI-021  
**ROLE:** Examiner, CCE  
**ROUTE:** `navigation`  
**SCREEN:** Primary navigation  
**COMPONENT:** Labels vs page titles  
**CATEGORY:** CONFUSING LABEL  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** "Question review" → page "Question bank"; "Schedule & approve" (examiner) and "Papers & results" (CCE) both → page "Examinations"; "Eligibility" and "Enrolment & eligibility" → page with no title (crash). Breadcrumb on non-menu routes (/programs, /students for examiner, /certificate) is blank ("Student ›").

**EXPECTED BEHAVIOR:** Menu label = page title = breadcrumb.

**WHY IT IS CONFUSING / ROOT CAUSE:** Labels are per-role but page titles are shared.

**USER IMPACT:** Users cannot confirm where they are.

**REPRODUCTION STEPS:** Compare the NAV table (doc 03) with each destination h1.

**SCREENSHOT EVIDENCE:** `evidence/examiner/e02-examinations-list.jpg`; `evidence/student/s01-dashboard-desktop.jpg`

**SOURCE FILE:** `apps/web/src/nav.ts; apps/web/src/ui.tsx PageHead`

**RECOMMENDED FIX:** Pass the role label into PageHead or rename the pages per role.

**ACCEPTANCE CRITERIA:** Automated test: nav label equals h1 for every menu item.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Computed from 7 role crawls.

---

## UI-022

**ISSUE ID:** UI-022  
**ROLE:** Examiner, CCE, Lecturer, Invigilator, Campus Admin, Super Admin  
**ROUTE:** `/students, /institutions, /programs, /questions, /exams`  
**SCREEN:** Navigation  
**COMPONENT:** Routes reachable but not in the menu  
**CATEGORY:** HIDDEN FUNCTION  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Reachable with real content and no menu entry: Students (examiner, CCE, invigilator), Institutions (5 roles), Programs & courses (all roles incl. students), Question bank (CCE, super admin), Exams list (invigilator), Live monitor (campus admin). Invigilators can read the full exam list including drafts.

**EXPECTED BEHAVIOR:** Each role sees exactly the pages it is meant to use; read-only reference pages are reachable from where they matter.

**WHY IT IS CONFUSING / ROOT CAUSE:** Menus and permissions are maintained separately.

**USER IMPACT:** Hidden capabilities and unclear intent (is the invigilator meant to read draft papers?).

**REPRODUCTION STEPS:** Doc 02 matrix (role × route).

**SCREENSHOT EVIDENCE:** `evidence/cross-role/x08-invigilator-dashboard.jpg`

**SOURCE FILE:** `apps/web/src/nav.ts; apps/api route manifest`

**RECOMMENDED FIX:** Review each role's read permissions; add nav entries or remove access.

**ACCEPTANCE CRITERIA:** Route matrix = menu matrix, reviewed by owner.

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Observed; intent needs owner decision.

---

## UI-023

**ISSUE ID:** UI-023  
**ROLE:** Examiner, Invigilator, Campus Admin  
**ROUTE:** `/dashboard`  
**SCREEN:** Dashboards  
**COMPONENT:** Tile-only dashboards  
**CATEGORY:** UNHELPFUL DASHBOARD  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Examiner: 4 tiles (all labels, no list). Invigilator: 3 tiles with no "Open live monitor" action. Campus admin: "Students 40 / Accounts 43 / Upcoming exams 3 / Open incidents 0" — "Upcoming" counts live exams, "Accounts" vs "Students" is ambiguous, nothing about attendance, eligibility or the live exam at their campus. Roughly 70% of each page is empty.

**EXPECTED BEHAVIOR:** Each dashboard answers "what needs me now?": pending approvals list, live exam with campus counts and a primary button.

**WHY IT IS CONFUSING / ROOT CAUSE:** Tiles were the only component built.

**USER IMPACT:** Extra navigation for the most common first action.

**REPRODUCTION STEPS:** Open /dashboard per role.

**SCREENSHOT EVIDENCE:** `evidence/examiner/e01-dashboard.jpg`; `evidence/campus/c01-dashboard.jpg`; `evidence/cross-role/x08-invigilator-dashboard.jpg`; `evidence/cross-role/x09-cce-dashboard.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/dashboard/page.tsx`

**RECOMMENDED FIX:** Add "Needs action" list and a role-specific primary action card.

**ACCEPTANCE CRITERIA:** Each role reaches its top task in one click from the dashboard.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser.

---

## UI-024

**ISSUE ID:** UI-024  
**ROLE:** Campus Admin  
**ROUTE:** `/users`  
**SCREEN:** Staff & accounts  
**COMPONENT:** Account list  
**CATEGORY:** REDUNDANT / DANGEROUS  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** "Staff & accounts" lists the 40 student accounts together with staff, each row carrying "Deactivate" and "Reset password" buttons, duplicating the Students page. The label says staff; the content is everyone.

**EXPECTED BEHAVIOR:** Staff accounts only (role filter default), students managed from Students; destructive actions confirmed.

**WHY IT IS CONFUSING / ROOT CAUSE:** One list for all users.

**USER IMPACT:** Risk of deactivating the wrong person; noisy.

**REPRODUCTION STEPS:** admin.a → Staff & accounts.

**SCREENSHOT EVIDENCE:** `evidence/campus/c04-staff-and-accounts.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/users/page.tsx`

**RECOMMENDED FIX:** Default the role filter to staff; move student account actions to the student record.

**ACCEPTANCE CRITERIA:** Default view lists staff only.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser.

---

## UI-025

**ISSUE ID:** UI-025  
**ROLE:** Super Admin  
**ROUTE:** `/institutions`  
**SCREEN:** Institutions  
**COMPONENT:** Deactivate button  
**CATEGORY:** DESTRUCTIVE ACTION WITHOUT CONFIRMATION  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Deactivate executes immediately (no dialog); the row flips to "Cancelled / Activate".

**EXPECTED BEHAVIOR:** Confirmation naming the consequences (users/exams affected) and the term "Inactive".

**WHY IT IS CONFUSING / ROOT CAUSE:** `run(patch(...))` directly on click (institutions/page.tsx:15).

**USER IMPACT:** One mis-click disables a campus.

**REPRODUCTION STEPS:** super.admin → Deactivate DNC-C.

**SCREENSHOT EVIDENCE:** `evidence/admin/a03-institution-deactivated-shows-cancelled.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/institutions/page.tsx:15`

**RECOMMENDED FIX:** Use the existing Confirm component.

**ACCEPTANCE CRITERIA:** Dialog with consequences before PATCH.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Clicked in browser.

---

## UI-026

**ISSUE ID:** UI-026  
**ROLE:** Lecturer, Examiner, Super Admin, Campus Admin  
**ROUTE:** `/exams, /questions modals`  
**SCREEN:** Forms  
**COMPONENT:** Create/Save buttons  
**CATEGORY:** FORM UX  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** "Create draft" (14 fields), "Save draft" (question) and "Register" are disabled until the form is valid, with no required markers (0 fields marked required), no inline messages and no hint about what is missing. Escape closes a modal and discards typed text without warning. The question modal is 769 px tall (scrolls on a 768 px laptop).

**EXPECTED BEHAVIOR:** Required markers, inline validation on blur, a summary of what is missing, unsaved-changes protection.

**WHY IT IS CONFUSING / ROOT CAUSE:** Validation is a boolean on the button.

**USER IMPACT:** Users see a dead button.

**REPRODUCTION STEPS:** examiner → New examination; lecturer → New question; read button disabled state and labels.

**SCREENSHOT EVIDENCE:** `evidence/examiner/e08-new-examination-form.jpg`; `evidence/lecturer/l03-new-question-form.jpg`; `evidence/admin/a06-register-institution-form.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/exams/page.tsx; questions/page.tsx; institutions/page.tsx`

**RECOMMENDED FIX:** Add `required` + asterisks, field-level errors and a dirty-check on close.

**ACCEPTANCE CRITERIA:** Every form shows what blocks submission.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured in browser.

---

## UI-027

**ISSUE ID:** UI-027  
**ROLE:** Examiner  
**ROUTE:** `/exams/:id (draft)`  
**SCREEN:** Paper builder  
**COMPONENT:** Question picker  
**CATEGORY:** TASK EFFICIENCY  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Building a paper means ticking checkboxes in an unfiltered list of all approved questions (110 rows, newest first): no search, no difficulty/topic filter, no select-all, no running total of questions/marks, no per-question marks. A 100-question paper is 100 clicks.

**EXPECTED BEHAVIOR:** Search/filter, bulk select by filter, marks column, live totals, drag ordering.

**WHY IT IS CONFUSING / ROOT CAUSE:** Simple table with checkboxes.

**USER IMPACT:** Slow and error-prone for real papers.

**REPRODUCTION STEPS:** examiner → draft exam.

**SCREENSHOT EVIDENCE:** `evidence/examiner/e03-draft-paper-builder.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/exams/[id]/page.tsx:20`

**RECOMMENDED FIX:** Add filters + "select all matching" + totals bar.

**ACCEPTANCE CRITERIA:** 100-question paper built in < 10 interactions.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser.

---

## UI-028

**ISSUE ID:** UI-028  
**ROLE:** All staff  
**ROUTE:** `list pages`  
**SCREEN:** Search / filter / pagination  
**COMPONENT:** List state  
**CATEGORY:** STATE LOSS  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Search text and filters are not in the URL and are lost on back navigation (search "Hira" → open dashboard → Back → empty search, 25 rows). The empty search result says "No students." without echoing the query or offering Clear. Pagination text works ("80 records / Page 1 of 4").

**EXPECTED BEHAVIOR:** Filters in the query string; empty state echoes the filter and offers reset.

**WHY IT IS CONFUSING / ROOT CAUSE:** Local component state.

**USER IMPACT:** Users repeat searches after every detail visit.

**REPRODUCTION STEPS:** super.admin → Students → search → navigate away → Back.

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/app/(app)/students/page.tsx`

**RECOMMENDED FIX:** Sync filters with `useSearchParams`.

**ACCEPTANCE CRITERIA:** Back restores filters.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser.

---

## UI-029

**ISSUE ID:** UI-029  
**ROLE:** Invigilator, Examiner, CCE  
**ROUTE:** `/monitor/:id, /exams/:id/control`  
**SCREEN:** Row actions  
**COMPONENT:** "+ Time", "End", "Report"  
**CATEGORY:** AMBIGUOUS LABELS  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Row buttons read "+ Time", "End" and "Report" with no candidate in their accessible name (189 identical "Report" buttons on one page). "End" ends a candidate's attempt (force-submit) but is styled like a secondary action. The Report dialog is good: it names the candidate and asks for a 10-character description.

**EXPECTED BEHAVIOR:** "Add time", "End attempt…" (confirmation), "Report incident" with row-aware aria-labels.

**WHY IT IS CONFUSING / ROOT CAUSE:** Short labels reused per row.

**USER IMPACT:** Screen-reader users hear the same button 78 times; "End" is easy to misread as "end session".

**REPRODUCTION STEPS:** invigilator.a → /monitor/<assigned exam>.

**SCREENSHOT EVIDENCE:** `evidence/examiner/e12-report-incident-modal.jpg`; `evidence/examiner/e09-monitor-your-campus-only.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/monitor/[examId]/page.tsx`

**RECOMMENDED FIX:** Rename and add aria-labels with the registration number.

**ACCEPTANCE CRITERIA:** No two controls on a page share an identical accessible name.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured (189 duplicates) + observed.

---

## UI-030

**ISSUE ID:** UI-030  
**ROLE:** CCE, Super Admin  
**ROUTE:** `/exams/:id/control`  
**SCREEN:** Control centre  
**COMPONENT:** Dialog confirm labels  
**CATEGORY:** DANGEROUS AMBIGUITY  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** The close-examination dialog's confirm button is labelled just "Close" and its dismiss ✕ has aria-label "Close": the dangerous action and the dismiss control share a name. "Close admission", "Close examination…" and the force-close checkbox are three different operations behind near-identical words; "Reconcile attempts" and "Initiate scoring" are system jargon.

**EXPECTED BEHAVIOR:** Distinct verbs: "Stop new entries", "End examination…", "Seal all attempts now"; confirm buttons repeat the exact action ("End examination").

**WHY IT IS CONFUSING / ROOT CAUSE:** Label reuse.

**USER IMPACT:** Wrong-button risk during a live exam.

**REPRODUCTION STEPS:** cce → control centre → open each dialog.

**SCREENSHOT EVIDENCE:** `evidence/admin/a08-control-dialog-close-examination.jpg`; `evidence/admin/a09-control-dialog-suspend.jpg`; `evidence/admin/a10-control-dialog-extend.jpg`; `evidence/admin/a07-control-centre.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/exams/[id]/control/page.tsx:205-236`

**RECOMMENDED FIX:** Rename per doc 18; change dismiss aria-label to "Cancel and close dialog".

**ACCEPTANCE CRITERIA:** Unique names; confirm button text equals action.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Opened each dialog in browser.

---

## UI-031

**ISSUE ID:** UI-031  
**ROLE:** All with bell  
**ROUTE:** `bell panel`  
**SCREEN:** Notifications  
**COMPONENT:** Notification panel  
**CATEGORY:** INFORMATION OVERLOAD  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Examiner and lecturer bells show 132 / 130 unread; the panel lists 100 (no pagination, no filter, only "Mark all read"). One example item for examiners ("Results ready for review") links to /results, a candidate-only page ("This page is for candidates."). Student links resolve correctly (/results, /schedule).

**EXPECTED BEHAVIOR:** Grouped/collapsed notifications, a visible total, working deep links per role.

**WHY IT IS CONFUSING / ROOT CAUSE:** One notification per event, no grouping; shared destination map.

**USER IMPACT:** Real approvals are buried; the link dead-ends.

**REPRODUCTION STEPS:** examiner → bell → click "Results ready for review".

**SCREENSHOT EVIDENCE:** `evidence/cross-role/x01-notifications-examiner-132-unread.jpg`; `evidence/examiner/e10-results-dead-end-for-staff.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/layout.tsx (Bell); notifications service`

**RECOMMENDED FIX:** Group by type; role-aware links.

**ACCEPTANCE CRITERIA:** Bell total matches list; no link lands on a "for candidates" page.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser (volume caused by 110 fixture submissions).

---

## UI-032

**ISSUE ID:** UI-032  
**ROLE:** Student  
**ROUTE:** `/profile`  
**SCREEN:** Profile  
**COMPONENT:** Phone field / validation  
**CATEGORY:** MISLEADING SUCCESS  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Entering "abc" as the phone number and pressing Save shows "Profile saved" and stores "abc" (checked in the database). The page also has two "Sign out" buttons (header and inside the password card).

**EXPECTED BEHAVIOR:** Format validation with an inline error; a single sign-out.

**WHY IT IS CONFUSING / ROOT CAUSE:** No server or client validation.

**USER IMPACT:** Bad contact data accepted; duplicate control confuses.

**REPRODUCTION STEPS:** student.a031 → Phone = abc → Save changes.

**SCREENSHOT EVIDENCE:** `evidence/student/s20-profile-invalid-phone-saved.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/profile/page.tsx; user DTO`

**RECOMMENDED FIX:** Add phone pattern to the DTO and form; remove the inner Sign out.

**ACCEPTANCE CRITERIA:** "abc" rejected with message.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed + database check.

---

## UI-033

**ISSUE ID:** UI-033  
**ROLE:** All staff  
**ROUTE:** `list pages`  
**SCREEN:** Loading states  
**COMPONENT:** Async/Loading  
**CATEGORY:** MISSING FEEDBACK  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** When a list API never answers, three skeleton bars remain indefinitely (observed 20 s) with no "taking longer than usual" message or retry. HTTP 500 handling is good ("Something went wrong on our side" + Try again).

**EXPECTED BEHAVIOR:** After ~8 s show "Still loading…" with Retry.

**WHY IT IS CONFUSING / ROOT CAUSE:** No timeout in the request helper.

**USER IMPACT:** Users cannot tell hung from slow.

**REPRODUCTION STEPS:** Intercept GET /api/exams and never respond.

**SCREENSHOT EVIDENCE:** `evidence/cross-role/x03-api-hang-20s-skeleton.jpg`; `evidence/cross-role/x04-api-500-friendly-error.jpg`

**SOURCE FILE:** `apps/web/src/ui.tsx:75-79; apps/web/src/api.ts`

**RECOMMENDED FIX:** Same timeout as UI-003; slow-load message.

**ACCEPTANCE CRITERIA:** A hung request surfaces a retry within 10 s.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser.

---

## UI-034

**ISSUE ID:** UI-034  
**ROLE:** Campus Admin  
**ROUTE:** `/students`  
**SCREEN:** Student list  
**COMPONENT:** Row actions / detail  
**CATEGORY:** MISSING REQUIRED UI  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Student rows have no link, button or detail view: a campus admin can search a student (e.g. DMC-A-2024-0009) but cannot open their record, see attendance/eligibility, or confirm exam-day attendance. Combined with UI-001 the "locate a student and confirm attendance" journey cannot be completed.

**EXPECTED BEHAVIOR:** Student detail page with enrolments, eligibility, attempts and an exam-day attendance action.

**WHY IT IS CONFUSING / ROOT CAUSE:** Not built (known D-07).

**USER IMPACT:** Primary campus task unsupported.

**REPRODUCTION STEPS:** admin.a → Students → search → inspect row.

**SCREENSHOT EVIDENCE:** `evidence/campus/c06-student-search-no-row-actions.jpg`; `evidence/campus/c03-students-list.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/students/page.tsx`

**RECOMMENDED FIX:** Add /students/:id and attendance register (design first).

**ACCEPTANCE CRITERIA:** Journey G completes in ≤ 4 steps.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed; status MISSING REQUIRED UI.

---

## UI-035

**ISSUE ID:** UI-035  
**ROLE:** Lecturer  
**ROUTE:** `/dashboard, navigation`  
**SCREEN:** Lecturer portal  
**COMPONENT:** Menu/dashboard  
**CATEGORY:** MISSING REQUIRED UI  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Menu: Dashboard, Question bank, Examinations, Students, My profile. No "My courses", no grading queue/manual grading, no course materials (reference pages 15, 17, 18). The dashboard shows "Students at campus 40" instead of assigned courses; "Examinations" lists every exam with copy "Build papers, approve, schedule, monitor and publish." that does not apply to a lecturer.

**EXPECTED BEHAVIOR:** Assigned courses first, with per-course question counts and review status.

**WHY IT IS CONFUSING / ROOT CAUSE:** Features not yet built; copy reused.

**USER IMPACT:** Lecturers cannot tell what they are authorised to manage.

**REPRODUCTION STEPS:** lecturer.a → dashboard/menu.

**SCREENSHOT EVIDENCE:** `evidence/lecturer/l01-dashboard.jpg`; `evidence/lecturer/l05-examinations-list.jpg`

**SOURCE FILE:** `apps/web/src/nav.ts`

**RECOMMENDED FIX:** Add "My courses" and role-specific copy.

**ACCEPTANCE CRITERIA:** Lecturer sees assigned courses on first screen.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed; reference comparison.

---

## UI-036

**ISSUE ID:** UI-036  
**ROLE:** Student (phone)  
**ROUTE:** `/exam/:id`  
**SCREEN:** Exam header  
**COMPONENT:** Sticky header  
**CATEGORY:** MOBILE USABILITY  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** The sticky header is 168 px high on 360–390 px phones (126 px on 768) and 76 px on desktop; at 640×360 (200% zoom) the Save/Skip/Next row is below the first screen.

**EXPECTED BEHAVIOR:** ≤ 56 px on phones.

**WHY IT IS CONFUSING / ROOT CAUSE:** Stacked flex-wrap rows.

**USER IMPACT:** Little room for long vignettes; focus can sit under the header (WCAG 2.4.11).

**REPRODUCTION STEPS:** Measure `.exam-bar` height.

**SCREENSHOT EVIDENCE:** `evidence/mobile/m12-player-200pct-zoom-640x360.jpg`; `evidence/mobile/m02-player-390x844-first-screen.jpg`

**SOURCE FILE:** `apps/web/src/app/globals.css (.exam-bar)`

**RECOMMENDED FIX:** Single-row compact header.

**ACCEPTANCE CRITERIA:** Header ≤ 15% of height at 360×640.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured.

---

## UI-037

**ISSUE ID:** UI-037  
**ROLE:** All  
**ROUTE:** `various`  
**SCREEN:** Charts/tiles  
**COMPONENT:** aria-pressed on non-interactive chips  
**CATEGORY:** ACCESSIBILITY (WCAG 4.1.2)  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** axe "critical" aria-allowed-attr: `<span class="chip" aria-pressed>` on the question-pipeline chips (dashboard, /questions): they look like filters but are not interactive.

**EXPECTED BEHAVIOR:** Real buttons that filter, or plain text.

**WHY IT IS CONFUSING / ROOT CAUSE:** Chip styled spans.

**USER IMPACT:** Misleading to screen readers; looks clickable.

**REPRODUCTION STEPS:** axe on /dashboard (lecturer) and /questions.

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/app/(app)/dashboard/page.tsx`

**RECOMMENDED FIX:** Make them links to filtered lists.

**ACCEPTANCE CRITERIA:** axe critical = 0.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Automated.

---

## UI-038

**ISSUE ID:** UI-038  
**ROLE:** Super Admin, CCE, Campus Admin  
**ROUTE:** `/audit`  
**SCREEN:** Audit trail  
**COMPONENT:** Table  
**CATEGORY:** TECHNICAL JARGON  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** Shows raw tokens: action "auth.login", role "campus_admin", entity "user ea48217f", empty Detail column, 7 columns including a hash. In the crawl screenshot the "When" cell wrapped to four lines (not reproduced in a later measurement).

**EXPECTED BEHAVIOR:** Human wording and linked entities; hash in a details drawer.

**WHY IT IS CONFUSING / ROOT CAUSE:** Direct dump of log fields.

**USER IMPACT:** Ordinary staff cannot read the trail.

**REPRODUCTION STEPS:** super.admin → Audit trail.

**SCREENSHOT EVIDENCE:** `evidence/admin/a04-audit-trail.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/audit/page.tsx`

**RECOMMENDED FIX:** Map action codes to sentences; show names.

**ACCEPTANCE CRITERIA:** Non-technical reviewer can answer "who did what".

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Observed; wrapping unstable.

---

## UI-039

**ISSUE ID:** UI-039  
**ROLE:** All (unauthenticated)  
**ROUTE:** `/login, /forgot, /verify, 404`  
**SCREEN:** Auth pages  
**COMPONENT:** Layout at 360–390 px  
**CATEGORY:** MOBILE LAYOUT  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** All four public pages scroll sideways by ≈ 2 px at 360 and 390 px (scrollWidth 392). Every public page logs a 401 console error (GET /api/auth/me) on load.

**EXPECTED BEHAVIOR:** No horizontal overflow; unauthenticated probe handled silently.

**WHY IT IS CONFUSING / ROOT CAUSE:** Auth grid + border; session probe uses a 401.

**USER IMPACT:** Cosmetic jitter; console noise.

**REPRODUCTION STEPS:** Playwright measures scrollWidth.

**SCREENSHOT EVIDENCE:** `evidence/cross-role/x10-public-login-390.jpg`; `evidence/mobile/m09-404-390-overflow.jpg`

**SOURCE FILE:** `apps/web/src/app/globals.css (.auth, .auth-art)`

**RECOMMENDED FIX:** Remove the extra 2 px; use /auth/me returning 200 {user:null}.

**ACCEPTANCE CRITERIA:** scrollWidth ≤ innerWidth at 360/390.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Measured.

---

## UI-040

**ISSUE ID:** UI-040  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Entry  
**COMPONENT:** Reload behaviour  
**CATEGORY:** EXTRA STEP  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** Reloading the exam page returns to the instructions page and requires "Resume" again.

**EXPECTED BEHAVIOR:** Reload resumes directly with a one-line notice.

**WHY IT IS CONFUSING / ROOT CAUSE:** Entry state not persisted.

**USER IMPACT:** One extra click after a refresh.

**REPRODUCTION STEPS:** Enter exam → reload.

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/app/exam/[examId]/page.tsx`

**RECOMMENDED FIX:** Auto-resume when an attempt is IN_PROGRESS.

**ACCEPTANCE CRITERIA:** Reload shows the timer.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed.

---

## UI-041

**ISSUE ID:** UI-041  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Long clinical stems  
**COMPONENT:** Question layout on phones  
**CATEGORY:** MOBILE LAYOUT  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** With a long vignette at 390×844 option A starts below the first screen (page height 2,278 px). The header and clock stay visible (good).

**EXPECTED BEHAVIOR:** Optional collapsible vignette or sticky action bar.

**WHY IT IS CONFUSING / ROOT CAUSE:** Linear layout.

**USER IMPACT:** More scrolling for long cases.

**REPRODUCTION STEPS:** Long-text paper on a phone.

**SCREENSHOT EVIDENCE:** `evidence/mobile/m05-player-long-vignette-390.jpg`; `evidence/student/s15-player-long-vignette-1440.jpg`

**SOURCE FILE:** `apps/web/src/app/globals.css`

**RECOMMENDED FIX:** Sticky bottom action bar.

**ACCEPTANCE CRITERIA:** Actions reachable without scrolling.

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Measured.

---

## UI-042

**ISSUE ID:** UI-042  
**ROLE:** Student  
**ROUTE:** `/performance, /results`  
**SCREEN:** Results vs Performance  
**COMPONENT:** Consistency  
**CATEGORY:** INCONSISTENT DATA  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** A student with a published "Absent" row in Results sees "No published results yet." on Performance. With a passed result both pages agree (Average 100%, Pass rate 100%).

**EXPECTED BEHAVIOR:** Both pages use the same definition.

**WHY IT IS CONFUSING / ROOT CAUSE:** Different filters.

**USER IMPACT:** Confusing for absent candidates.

**REPRODUCTION STEPS:** student.a004.

**SCREENSHOT EVIDENCE:** `evidence/student/s18-performance.jpg`; `evidence/student/s16-results-published.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/performance/page.tsx`

**RECOMMENDED FIX:** Explain or include absences.

**ACCEPTANCE CRITERIA:** Same set of results on both pages.

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Observed.

---

## UI-043

**ISSUE ID:** UI-043  
**ROLE:** All  
**ROUTE:** `tables`  
**SCREEN:** Tables  
**COMPONENT:** Semantics  
**CATEGORY:** ACCESSIBILITY (WCAG 1.3.1)  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** 101 tables: none has a caption; only 6 have header scope; 37 pages have an empty `<th>` (action column); the scrollable table wrapper is not keyboard-focusable on 2 pages.

**EXPECTED BEHAVIOR:** Captions/aria-label, scope="col", labelled action column.

**WHY IT IS CONFUSING / ROOT CAUSE:** Shared Table component omits them.

**USER IMPACT:** Screen-reader table navigation is weaker.

**REPRODUCTION STEPS:** axe: empty-table-header, scrollable-region-focusable.

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/ui.tsx Table`

**RECOMMENDED FIX:** Add caption prop + scope.

**ACCEPTANCE CRITERIA:** axe table rules clear.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Automated.

---

## UI-044

**ISSUE ID:** UI-044  
**ROLE:** All  
**ROUTE:** `all`  
**SCREEN:** Global  
**COMPONENT:** Bell accessible name  
**CATEGORY:** ACCESSIBILITY (WCAG 2.5.3)  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** The bell's accessible name "Notifications, 5 unread" does not contain its visible text "Notifications 5" in order (axe label-content-name-mismatch on 105 pages).

**EXPECTED BEHAVIOR:** Accessible name starts with the visible label.

**WHY IT IS CONFUSING / ROOT CAUSE:** aria-label differs.

**USER IMPACT:** Voice-control users.

**REPRODUCTION STEPS:** axe.

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/app/(app)/layout.tsx`

**RECOMMENDED FIX:** aria-label="Notifications 5".

**ACCEPTANCE CRITERIA:** axe clear.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Automated.

---

## UI-045

**ISSUE ID:** UI-045  
**ROLE:** All  
**ROUTE:** `all`  
**SCREEN:** Global  
**COMPONENT:** Landmarks / headings  
**CATEGORY:** ACCESSIBILITY (WCAG 1.3.1)  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** 43 loads have no <h1> (student-only pages shown to staff, enrolment crash); the exam player has no <main> landmark (14 loads).

**EXPECTED BEHAVIOR:** One h1 and one main per page.

**WHY IT IS CONFUSING / ROOT CAUSE:** Player shell and placeholder pages.

**USER IMPACT:** Navigation by headings/landmarks.

**REPRODUCTION STEPS:** axe page-has-heading-one, landmark-one-main.

**SCREENSHOT EVIDENCE:** _none (measured/automated finding — see `data/`)_

**SOURCE FILE:** `apps/web/src/app/exam/[examId]/page.tsx`

**RECOMMENDED FIX:** Wrap player in <main>.

**ACCEPTANCE CRITERIA:** axe clear.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Automated.

---

## UI-046

**ISSUE ID:** UI-046  
**ROLE:** All  
**ROUTE:** `all`  
**SCREEN:** Design system  
**COMPONENT:** Tokens  
**CATEGORY:** VISUAL CONSISTENCY  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** 11 distinct border-radius values, 13 font sizes (10–30 px), 18 hard-coded hex colours in CSS outside tokens, 14 in TSX and 101 inline `style={{}}` blocks. Base font is a fixed 14 px (no rem), so browser text-size settings are ignored. Crimson is both the primary action colour and the danger colour.

**EXPECTED BEHAVIOR:** Token scale; rem-based type.

**WHY IT IS CONFUSING / ROOT CAUSE:** Incremental growth.

**USER IMPACT:** Drift and accessibility (WCAG 1.4.4 potential).

**REPRODUCTION STEPS:** Doc 16.

**SCREENSHOT EVIDENCE:** `evidence/admin/a07-control-centre.jpg`

**SOURCE FILE:** `apps/web/src/app/globals.css; 101 inline styles`

**RECOMMENDED FIX:** Consolidate tokens; rem font sizes.

**ACCEPTANCE CRITERIA:** Token audit script passes.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Computed from source.

---

## UI-047

**ISSUE ID:** UI-047  
**ROLE:** All  
**ROUTE:** `form controls`  
**SCREEN:** Global  
**COMPONENT:** Control boundaries  
**CATEGORY:** ACCESSIBILITY (WCAG 1.4.11)  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** Input, select and option-card borders (#E9DDDA on white) are 1.33:1; WCAG asks 3:1 for the boundary of a UI component.

**EXPECTED BEHAVIOR:** ≥ 3:1 boundary or other visible affordance.

**WHY IT IS CONFUSING / ROOT CAUSE:** Decorative rose border reused.

**USER IMPACT:** Low-vision users cannot see field edges.

**REPRODUCTION STEPS:** Computed ratio (doc 16); not caught by axe.

**SCREENSHOT EVIDENCE:** `evidence/examiner/e08-new-examination-form.jpg`

**SOURCE FILE:** `apps/web/src/app/globals.css (input.in, .opt)`

**RECOMMENDED FIX:** Use a darker border for inputs.

**ACCEPTANCE CRITERIA:** Border ≥ 3:1.

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Computed; potential issue.

---

## UI-048

**ISSUE ID:** UI-048  
**ROLE:** Student  
**ROUTE:** `/certificate/:id`  
**SCREEN:** Certificate  
**COMPONENT:** Error state  
**CATEGORY:** MISLEADING AFFORDANCE  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** For an invalid or non-existent certificate the error card "We could not find that — Certificate not found" is shown beneath an active "Print certificate" button and a blank breadcrumb. Certificates exist only for passing results (a passed candidate got SZABMU/2026/1000).

**EXPECTED BEHAVIOR:** No print action on an error; explain that certificates are issued for passes.

**WHY IT IS CONFUSING / ROOT CAUSE:** Static header.

**USER IMPACT:** Minor.

**REPRODUCTION STEPS:** student → /certificate/<bad id>.

**SCREENSHOT EVIDENCE:** `evidence/student/s17-certificate.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/certificate/[id]/page.tsx`

**RECOMMENDED FIX:** Hide Print in error state.

**ACCEPTANCE CRITERIA:** Done.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed.

---

## UI-049

**ISSUE ID:** UI-049  
**ROLE:** Examiner, Lecturer, CCE  
**ROUTE:** `/exams`  
**SCREEN:** Examinations list  
**COMPONENT:** Columns and copy  
**CATEGORY:** MINOR CLARITY  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** Columns "MIN", "QS", "CANDIDATES" abbreviate; "Opens" shows the planned window even for manual-control exams already live; no direct "Control centre" link in the list (needs Open › first); subtitle "Build papers, approve, schedule, monitor and publish." is shown to every role.

**EXPECTED BEHAVIOR:** Role-specific subtitle; status-aware "Opens".

**WHY IT IS CONFUSING / ROOT CAUSE:** Shared page.

**USER IMPACT:** Small.

**REPRODUCTION STEPS:** /exams as lecturer/examiner.

**SCREENSHOT EVIDENCE:** `evidence/examiner/e02-examinations-list.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/exams/page.tsx`

**RECOMMENDED FIX:** Copy and column tweaks.

**ACCEPTANCE CRITERIA:** Reviewed copy.

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Observed.

---

## UI-050

**ISSUE ID:** UI-050  
**ROLE:** All  
**ROUTE:** `no search / help`  
**SCREEN:** Global chrome  
**COMPONENT:** Top bar  
**CATEGORY:** MISSING REQUIRED UI  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** No global search, no help/support or policy link, no institution/campus switcher (campus is only shown as plain text at the foot of the sidebar). The reference deck has a global search and messages icon.

**EXPECTED BEHAVIOR:** Search for exams/students/questions; help link; visible campus context in the top bar.

**WHY IT IS CONFUSING / ROOT CAUSE:** Not built.

**USER IMPACT:** Context is easy to miss for multi-campus users.

**REPRODUCTION STEPS:** Inspect top bar.

**SCREENSHOT EVIDENCE:** `evidence/admin/a01-dashboard.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/layout.tsx`

**RECOMMENDED FIX:** Add after design decision.

**ACCEPTANCE CRITERIA:** Campus visible in header for scoped roles.

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Observed; reference comparison.

---

## UI-051

**ISSUE ID:** UI-051  
**ROLE:** Student  
**ROUTE:** `/schedule, /dashboard, /exam/:id`  
**SCREEN:** Eligibility feedback  
**COMPONENT:** Empty state for an excluded candidate  
**CATEGORY:** MISSING FEEDBACK  
**SEVERITY:** P2 — Medium  

**CURRENT BEHAVIOR:** A student excluded for attendance below the threshold (DMC-A-2024-0001) sees "Upcoming exams 0" and "No examinations are scheduled for you yet." The exam URL says only "You are not registered for this examination. Back to schedule". Nothing states that eligibility was withdrawn, why, or whom to contact.

**EXPECTED BEHAVIOR:** "You are not eligible for Pathology Mid-term (attendance 62 % — minimum 75 %). Contact your campus administrator by <date>."

**WHY IT IS CONFUSING / ROOT CAUSE:** Ineligible candidates are simply left off the roster, so the UI has nothing to show.

**USER IMPACT:** Students discover on exam day that they cannot sit and receive no explanation; support load falls on campus administrators.

**REPRODUCTION STEPS:** Sign in as student.a001 → dashboard, schedule, then open /exam/<id>.

**SCREENSHOT EVIDENCE:** `evidence/student/s23-ineligible-student-schedule.jpg`; `evidence/student/s24-ineligible-student-exam-url.jpg`

**SOURCE FILE:** `apps/web/src/app/(app)/schedule/page.tsx; apps/api me/exams`

**RECOMMENDED FIX:** Return excluded exams with a reason code and show them as "Not eligible" rows.

**ACCEPTANCE CRITERIA:** Excluded candidate sees the exam with reason and contact.

**CONFIDENCE:** High  
**VERIFICATION STATUS:** Observed in browser.

---

## UI-052

**ISSUE ID:** UI-052  
**ROLE:** Student  
**ROUTE:** `/exam/:id`  
**SCREEN:** Long answer options  
**COMPONENT:** Option cards on phones  
**CATEGORY:** MOBILE LAYOUT  
**SEVERITY:** P3 — Low  

**CURRENT BEHAVIOR:** With 5 very long options (≈ 520 characters each — an extreme fixture) each option card is 157 px tall at 1440 and 439 px at 390; the page is 2,843 px tall on a phone and Save & next is far below the first screen. Text wraps correctly with no clipping or horizontal overflow.

**EXPECTED BEHAVIOR:** Acceptable wrapping; consider a sticky bottom action bar so Next/Mark stay reachable.

**WHY IT IS CONFUSING / ROOT CAUSE:** Linear layout.

**USER IMPACT:** More scrolling for rare long-option items.

**REPRODUCTION STEPS:** Long-text paper, question 8 at 390×844.

**SCREENSHOT EVIDENCE:** `evidence/mobile/m13-player-long-answer-options-390.jpg`; `evidence/student/s25-player-long-answer-options-1440.jpg`

**SOURCE FILE:** `apps/web/src/app/globals.css (.opt)`

**RECOMMENDED FIX:** Sticky bottom action bar on phones.

**ACCEPTANCE CRITERIA:** Primary actions reachable without scrolling to the end of long options.

**CONFIDENCE:** Medium  
**VERIFICATION STATUS:** Measured; fixture is deliberately extreme.

---

## Status of previously reported UI defects (docs/audit/current-build-analysis/13-ui-ux-review.md)

| Previous finding | Now | Current evidence | File |
|---|---|---|---|
| U-1 Mobile/tablet sidebar stacks above content | **RESOLVED** | Drawer navigation below 1024 px; control centre starts at the top of the page at 390/768 px | `evidence/mobile/m06-control-centre-390.jpg` |
| U-2 Player palette below the fold on phones | **PARTLY RESOLVED** | Bottom sheet exists; still 3–4 interactions to reach a distant question (UI-017) | `evidence/mobile/m03-player-390x844-palette-sheet.jpg` |
| U-3 /favicon.ico 404 on every page | **RESOLVED** | 0 favicon failures in 197 loads | `(crawl data)` |
| U-4 Examiner /results has no heading | **STILL PRESENT** | Page shows only "This page is for candidates." (UI-018, UI-031) | `evidence/examiner/e10-results-dead-end-for-staff.jpg` |
| U-5 Notification links to non-existent routes | **PARTLY RESOLVED** | Sampled links resolve; one examiner link lands on a candidate-only page (UI-031) | `evidence/cross-role/x01-notifications-examiner-132-unread.jpg` |
| U-6 No error / not-found boundaries | **RESOLVED** | Branded 404, route error boundary, friendly API-error card all observed | `evidence/cross-role/x04-api-500-friendly-error.jpg` |
| U-7 Bell shows 22 notifications, no grouping | **STILL PRESENT (worse with volume)** | 132 unread, panel capped at 100 (UI-031) | `evidence/cross-role/x01-notifications-examiner-132-unread.jpg` |
| Mobile shell touch targets | **IMPROVED** | 40 px minimum on ≤ 1023 px; palette buttons 44 px in sheet | `—` |
