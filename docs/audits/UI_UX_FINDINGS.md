# UI/UX and accessibility findings — 2026-11 full-system audit

Builds on `docs/ui-ux-audit/2026-11-02-ui-ux-audit.md` (findings A-01…A-18, screenshots) and the remediation series `docs/ui-ux-remediation/`.
New in this audit: the automated accessibility scans were found not to run at all (UI-A11Y-00), were enabled, and were extended to the critical journeys.
Automated scans detect only part of the possible barriers; nothing here is a WCAG conformance claim. No manual screen-reader pass was done in this audit.

Severity: P1 misleads or blocks a core task / excludes users · P2 friction with a workaround · P3 polish.

## New findings (this audit)

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| UI-A11Y-00 | **P1** | All four axe scans in `tests/e2e/a11y.spec.ts` were **skipped** because `@axe-core/playwright` was not installed, so no automated accessibility check ran in CI | baseline Playwright run: "4 skipped" (`test.skip(!Axe, …)`) | **Verified fixed**: dev dependency added (4.14.0, exact); the 4 scans now run and pass |
| UI-A11Y-01 | **P1** | Exam palette buttons: visible text "02", accessible name "Question 2, not visited" — fails WCAG 2.5.3 *Label in Name* (Level A); voice-control users cannot say what they see | axe `label-content-name-mismatch` (serious) on the active exam screen, new scan `a11y-critical.spec.ts` | **Verified fixed**: buttons show the plain number; scan passes; 33 exam-player e2e tests pass |
| UI-A11Y-02 | P2 | Accessibility scans covered 4 screens; the exam player, sign-up, review/confirm/receipt, live control, monitor and teacher administration were never scanned | spec inventory | **Fixed**: `tests/e2e/a11y-critical.spec.ts` scans 11 more states (16 in total with a11y.spec.ts); all pass (serious/critical = 0) |
| A-12 | **P1** (was P2) | Deactivate and Reset password on staff accounts act on one click, no confirmation (a mis-click can lock out a controller during an exam or replace a colleague's password) | code `users/page.tsx` | **Verified fixed**: confirmation dialogs stating the consequence; `tests/e2e/users-confirm.spec.ts` (cancel changes nothing; confirm acts) |

## Carried forward from the 2026-11-02 audit (status re-checked in code)

| ID | Sev | Finding | Status |
|---|---|---|---|
| A-01 | P1 | Raw UTC timestamps in notifications | Fixed earlier (`humanizeTimes`), test `polish.spec.ts` |
| A-02 | P1 | Student's main action below the fold on phones | Fixed earlier, test `polish.spec.ts` |
| A-03 | P2 | Read-only profile fields look editable | **Fixed**: name and email are now plain label/value rows like the academic details; only editable fields are inputs (`ui-audit-batch3.spec.ts`). The Save button is still at the top of the card |
| A-04 | P2 | Long stacked cards for tables on phones | **Fixed for Students, Audit trail, Question bank**: on phones each row shows the key columns and a "Show details" toggle (`aria-expanded`, per-row accessible name) for the rest; desktop unchanged. Row height at 390 px: students 208→144 px, audit 177–214→about 110–150 px (Who folded too), questions 266–295→164–193 px (`phone-compact-rows.spec.ts`, incl. axe). Other tables still stack in full — the mechanism is `Col.more` in `ui.tsx`, opt-in per table |
| A-05 | P2 | Dashboards list counts, not "what needs me now" | **Fixed for CCE, Examiner, Campus admin, Invigilator, Lecturer**: a "Needs your attention" card leads the dashboard — only non-zero items, urgent ones first (incidents, live exams), plain sentences, each linking to the exact list; "Nothing needs your action right now." when empty. Built from the counts the dashboard API already returns (no API change). Tiles show a › arrow so touch users can tell they are links (`dashboard-attention.spec.ts`, incl. axe). Students keep "Your examinations"; super administrator has no attention list (counts only) |
| A-06 | P2 | Disabled primary buttons without an explanation | **Fixed** for Sign in and Update password: buttons stay enabled; pressing them names each missing/invalid field and sends nothing (`explained-buttons.spec.ts`). The forgot-password page still disables its button until the new password is valid (its strength meter explains why) |
| A-07 | P2 | Targets below 24×24 px in question bank and exams list (WCAG 2.5.8) | **No violation found (automated)**: axe WCAG 2.2 AA incl. `target-size` passes on /questions, /exams and /audit (`a11y-lists.spec.ts`). Not re-measured by hand |
| A-08 | P2 | Live monitor repeats "Report incident" per row; duplicate "Not started" | **Fixed**: Connection shows "—" until an attempt exists (Status alone says "Not started"); the per-row incident control is a quiet "Incident…" link with the same per-candidate accessible name. `staff`, `exam-control`, `responsive`, `a11y-critical` specs pass |
| A-09 | P2 | "Withdraw…" on every roster row with equal weight | **Fixed (weight)**: a quiet link-style control; the action itself is still confirmed with a reason (`ui-audit-batch3.spec.ts`, `staff.spec.ts`). Not turned into a row menu |
| A-10 | P2 | Audit trail labels are developer terms | **Fixed**: plain-language Activity filter (14 groups) and friendly entity names replace the free-text prefix box; 'Entry no.' header; old `?action=` links still work (`list-state-and-paper.spec.ts`). Rows already used plain-language action labels |
| A-11 | P2 | Enrolment: arbitrary default course, free-text term | **Fixed (term)**: term chosen from terms in use with exam/enrolment counts (`GET /courses/:id/terms`, campus-scoped); a typed new term is upper-cased and warned about when no exam uses it. Tests: `course-terms.test.ts`, `enrolment.spec.ts`. Default course still the first in the list |
| A-13 | P3 | Breadcrumb repeats the page title | Open (already hidden on small phones; specs read `.crumbs b`, so left as is) |
| A-14 | P3 | Exam list: two links per row, code wraps | **Fixed**: one link per row (the code), kept on one line (`ui-audit-batch3.spec.ts`) |
| A-15 | P3 | Question bank headers cryptic | **Fixed**: "Difficulty", "In papers", "Correct" (item analysis "Difficulty" too); course code no longer wraps |
| A-16 | P3 | Results and Performance near-identical empty pages | Open (policy decision) |
| A-17 | P3 | Sign-out icon only | **Fixed**: visible "Sign out" label next to the icon |
| A-18 | P3 | Sidebar unused height | Open (cosmetic) |

## What was verified to work well (evidence)
- Exam player: one forward action, autosave with a server-confirmed "Saved" state, unsynced answers shown as "not yet confirmed", palette with non-colour glyphs, roving tabindex and keyboard jump (`exam-player-safety.spec.ts`, 33 exam-player tests pass).
- Dialogs trap focus, close on Escape and return focus; notification menu keyboard behaviour (`a11y.spec.ts` keyboard tests).
- Responsive shell and phone layouts (`responsive.spec.ts`).

## Not done in this audit
- Manual screen-reader passes (NVDA/VoiceOver) of the exam journey; 200 % zoom/reflow checks beyond the automated responsive tests; a redesign of the
  administrative information architecture (Phase 5.4) — these remain on the tracker.
