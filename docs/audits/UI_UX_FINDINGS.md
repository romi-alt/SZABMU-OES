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
| A-03 | P2 | Read-only profile fields look editable | Partly addressed by the new profile page (identity shown as text); re-check |
| A-04 | P2 | Long stacked cards for tables on phones | Open |
| A-05 | P2 | Dashboards list counts, not "what needs me now" | Open (tiles are deep links) |
| A-06 | P2 | Disabled primary buttons without an explanation | Open |
| A-07 | P2 | Targets below 24×24 px in question bank and exams list (WCAG 2.5.8) | Open — the question bank is not yet in the axe scan set |
| A-08 | P2 | Live monitor repeats "Report incident" per row; duplicate "Not started" | Open |
| A-09 | P2 | "Withdraw…" on every roster row with equal weight | Open (the action itself is confirmed with a reason) |
| A-10 | P2 | Audit trail labels are developer terms | Open |
| A-11 | P2 | Enrolment: arbitrary default course, free-text term | Open |
| A-13…A-18 | P3 | Breadcrumb repetition, duplicate links, cryptic headers, empty pages, sign-out icon only, sidebar height | Open |

## What was verified to work well (evidence)
- Exam player: one forward action, autosave with a server-confirmed "Saved" state, unsynced answers shown as "not yet confirmed", palette with non-colour glyphs, roving tabindex and keyboard jump (`exam-player-safety.spec.ts`, 33 exam-player tests pass).
- Dialogs trap focus, close on Escape and return focus; notification menu keyboard behaviour (`a11y.spec.ts` keyboard tests).
- Responsive shell and phone layouts (`responsive.spec.ts`).

## Not done in this audit
- Manual screen-reader passes (NVDA/VoiceOver) of the exam journey; 200 % zoom/reflow checks beyond the automated responsive tests; a redesign of the
  administrative information architecture (Phase 5.4) — these remain on the tracker.
