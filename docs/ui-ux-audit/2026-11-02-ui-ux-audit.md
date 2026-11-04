# UI / UX audit — 2 November 2026

**Subject:** the web app (`apps/web`) at branch `claude/oes-platform-foundation` (equal to `origin/main` plus the sign-in redesign, staff-portal wording, and exam-player polish).
**Status of this document:** findings only. Nothing was changed while auditing. Classification of the product is unchanged: INTERNAL_TESTING_READY; this audit makes no pilot or production-readiness claim.

## 1. How it was done, and what it does not cover

| Item | Detail |
|---|---|
| Crawl | Signed in as seven demo roles (student, lecturer, examiner, campus admin, invigilator, CCE, super admin) on a disposable seeded stack, visited every menu route plus the exam and live-monitor detail pages at **1366×800 and 390×844** — **98 screens**, each with a full-page screenshot. |
| Automated checks per screen | axe-core 4.14 (WCAG 2.0/2.1/2.2 A+AA and best-practice rules); horizontal overflow; interactive targets smaller than 24×24 CSS px; heading count and order; images without `alt`; text below 12 px; console errors and 4xx/5xx responses; first ten Tab stops checked for a visible focus indicator; page titles. |
| Manual review | I read the screenshots for every role and for both viewports. Contrast for the sidebar text (axe could not resolve it over the gradient) was computed by hand from the CSS colours. |
| **Not covered here** | Screens that need special state: the exam player (reviewed in the previous change), control centre, paper builder, modals, auth pages (reviewed when redesigned). Published-results screens (seed data has none), incidents (none exist), real data volumes (8–22 rows, not hundreds). Screen readers, 200–400 % zoom, real phones, slow networks, and the live Neon/Upstash latency. Automated checks catch only part of WCAG; **this audit does not claim WCAG conformance.** |
| Data caveat | Local seeded data. Several screens are therefore empty states (Results, Performance, Incidents, Student register). Findings about volume are reasoned from layout, not measured with large data. |

## 2. What is working well (measured)

- **axe: 0 violations on all 98 screens** (WCAG A/AA + best-practice). axe reported 9 "needs review" contrast nodes per signed-in page, all sidebar text on the burgundy gradient; computed by hand they pass: menu text 8.4–12.3:1, section label 5.6–8.1:1, white title 12–17:1.
- **No horizontal overflow at 390 px** on any screen.
- Exactly **one `<h1>` per screen**, no skipped heading levels, **no images without `alt`**.
- **Visible focus indicator** on the first ten Tab stops of every desktop screen.
- **No console errors and no failed API calls** on any screen.
- Page titles are distinct per route ("Examinations · SZABMU OES", the exam's own title on its detail page).
- Text colours tested (muted text 5.9–6.4:1, placeholder 5.1:1, amber/green badges 5.3–7.0:1) are above 4.5:1.

## 3. Findings

Severity: **P1** misleads or blocks a core task; **P2** clear friction, workaround exists; **P3** polish. "Evidence" names the screenshot or measurement. Items marked *(known)* are already in `docs/ui-ux-remediation/11-issue-tracker.md`.

### P1

**A-01 — Conflicting time zones in notifications. FIXED (3 Nov 2026).** The student dashboard's Recent activity shows *"Opens 2026-11-02T13:05:31.173Z"* (raw ISO string, UTC) while the schedule beside it shows *"02 Nov 2026 18:05"* (server local time). The two differ by five hours on a screen whose job is to say when an exam opens.
*Cause:* the notification body is built on the server with `exam.opensAt.toISOString()` (`apps/api/src/modules/exams/exams.service.ts:150`). *Fix direction:* send structured data (or a pre-formatted local string) and format it with the same helper the schedule uses; additive API change.
*Fixed by:* the web app now rewrites any ISO timestamp inside notification text with the app's own date formatter (`humanizeTimes`, `apps/web/src/api.ts`), in the dashboard feed and the bell panel, so existing stored notifications are corrected too; the API is unchanged. Test: `polish.spec.ts` (A-01).

**A-02 — On a phone, a student's main action is below the fold. FIXED (3 Nov 2026).** At 390×844 the dashboard stacks four tiles (Open now, Scheduled, Results published, Average score — about one full screen) before "Your examinations → Start". The reason a candidate opens the app is the fourth thing they scroll to. *Fix direction:* put the exam card first on phones, or show the tiles as a compact 2×2 grid.
*Fixed by:* dashboard tiles are a two-column strip on phones (`.dash-tiles`); the examinations card, with its Start button, is now on the first screen at 390×844. Test: `polish.spec.ts` (A-02).

### P2

**A-03 — Read-only profile fields look editable.** Registration number, programme, institution, email and date of birth use the same bordered input as Phone and Address; only the name field carries "Managed by your institution". Emails and the institution name are visibly truncated on desktop. "Save changes" sits at the top of a long form, out of view on a phone. *Fix direction:* render managed fields as plain label/value rows, keep editable fields as inputs, add a Save at the end.

**A-04 — Mobile tables become very long stacked cards.** Each student is seven lines, each audit entry six, each question nine. Eight students fill roughly three and a half screens. With real cohorts (hundreds) this needs a compact card (two or three lines showing the key fields), with details on demand. Evidence: phone screenshots of Students, Audit trail, Question bank.

**A-05 — Dashboards list counts but not "what needs me now".** *Correction (3 Nov 2026): the first version of this report said the stat tiles are not clickable. That was wrong — each tile is a link with a deep link, for example Papers to approve opens the pending-paper list; I had read the `Stat` component, not the page that wraps it.* What remains true: there is no prioritised "needs your attention" list, nothing in a tile signals that it is a link on touch screens (no arrow), and the student's "Quick actions" repeat the four menu items exactly *(known: UI-023, NOT_STARTED).*

**A-06 — Disabled primary buttons without an explanation.** Sign in and Update password are washed out (white on pale rose, 2.9:1) until fields are filled, with no hint why. Disabled controls are exempt from contrast rules, but the pattern hides the reason and looks broken. *Fix direction:* keep the button enabled and show field errors on submit (the form fields already have inline errors), or add a short hint.

**A-07 — Small targets in lists.** Measured below 24×24 CSS px: question-text buttons in the question bank (15 px high, 8–12 per page), exam code and "Open ›" links in the exams table (17–19 px), the audit "Examination xxxx" link on phones (19 px). Row spacing probably satisfies the WCAG 2.2 spacing exception, so this is not asserted as a failure, but 15–19 px is hard on touch. *Fix direction:* ≥ 32 px hit area (padding) for row links.

**A-08 — Live monitor repeats the same control and the same word.** "Report incident" appears on every row (14 identical buttons). The Status and Connection columns both read "Not started". The registration number wraps ("DMC-A-2024-" / "0002") on desktop. *Fix direction:* a row menu or "Report incident" once per selection; show Connection only once a candidate has started; widen or `nowrap` the reg-no column.

**A-09 — Exam detail: a destructive action on every roster row.** "Withdraw…" is repeated on all 14 candidate rows with equal weight. The approved-paper card shows only "12 questions · 24 marks". I did not verify whether the approver sees the paper content anywhere else, so that part is a question, not a finding. *Fix direction:* overflow menu per row; confirm dialog already exists for withdraw, so no new risk.

**A-10 — Audit trail speaks developer.** Filter label "Action starts with — e.g. auth.", a `#` sequence column, About values like "Question 62876f30", and one routine row per question create/submit/approve (70+ in a page). No date range. *(partly known: UI-038.)* *Fix direction:* a category filter (Sign-in, Questions, Exams, Accounts), a date range, and names instead of hex ids where the record still exists.

**A-11 — Enrolment starts with an arbitrary course and a free-text term.** The course select defaults to the first alphabetical option (BSN-FUND-1) and the term is a plain text box ("2026-SPRING"), so a typo creates a different term silently. The empty table says "No enrolments…" before anything meaningful was chosen. *Fix direction:* placeholder "Choose a course", term as a select of known terms.

**A-12 — Destructive account actions sit side by side, unconfirmed.** Staff accounts: Deactivate and Reset password are adjacent neutral buttons; the tracker records them as unconfirmed *(known: UI-024)*. Institutions: Deactivate per row. Not re-tested in this crawl.

### P3

**A-13 — Breadcrumb repeats the page title** directly above the heading ("Student › Dashboard" then "Welcome back…"). It is small, low value, and costs a line on phones.

**A-14 — Exam list: two links per row and awkward wrapping.** The code link and "Open ›" go to the same place; "Open ›" wraps so the chevron lands on its own line; the code wraps at the hyphen ("MBBS-" / "PATH-MT").

**A-15 — Question bank headers are cryptic.** "Key" (correct option), "Used" (number of papers), "Diff." The course code wraps mid-code. Status and filters are otherwise clear.

**A-16 — Results and Performance are two near-identical empty pages for a student with nothing published** *(known: UI-042, policy decision)*.

**A-17 — Sign-out is an icon with a tooltip only.** It has an accessible name ("Sign out"), but touch users never see the tooltip. A label inside the user menu would be clearer.

**A-18 — Sidebar has large unused height on short menus** (student, invigilator). Cosmetic.

## 4. Suggested order of work

1. A-01 (one server string; high value for an exam product) and A-02 (CSS reorder).
2. A-03, A-06, A-11 (small, local changes).
3. A-08, A-09, A-10 (monitor, roster, audit tidy-ups).
4. A-04, A-05, A-07 (larger: compact mobile rows, actionable dashboard, hit areas) and the policy items already tracked.

## 5. Evidence

Screenshots, per-screen JSON (axe nodes, small targets, overflow) and contact sheets were produced in the session scratchpad (`/tmp/claude-0/audit/`, 98 PNGs and 7 JSON files). They are not committed because they are bulky and reproducible; the crawl script was temporary and removed. Re-running it needs `axe-core` installed outside the repo.
