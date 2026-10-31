# 13 — UI/UX review

Inspected in headless Chromium against the real running application (disposable stack, clean seed). 68 page×width loads for 6 roles, plus the live exam player at 390 and 1280 px. Screenshots: `/tmp/audit-shots/` (46 files; session-local, not committed). I looked at the student dashboard (390), examiner exams (1280), invigilator monitor (768), and the exam player (390, 1280); the remaining screenshots were captured but only checked through automated layout metrics.

## Strengths (observed)

- Institutional identity is consistent: maroon/burgundy shell, ivory content area, academic-green primary actions, crimson alerts, the university logo lockup in the sidebar and player header. No stock-template look; typographic hierarchy (mono small-caps table headers, clear page titles) is coherent.
- Exam player at 1280 px is clean: question stem panel, labelled options A–E, sticky action bar, saving indicator, timer, **question palette with colour-coded states, filter chips and counts**, keyboard hint. At 390 px the stem/options/actions fit without horizontal scroll.
- Zero horizontal overflow and zero unlabeled form controls in all 68 loads; images have alt text.
- Tables: readable, right-aligned numerics, status pills, pagination with record count.

## Defects (observed)

| ID | Sev | Observation |
|---|---|---|
| U-1 | P2 | **Mobile/tablet shell**: below the desktop breakpoint the sidebar renders as a full block above content. At 390 px the page body starts ≈ 420 px down (of a 900 px viewport); at 768 px the logo is enlarged to ≈ 200 px and the nav pushes content to ≈ 570 px. There is no collapsible menu. Staff dashboards on tablets are usable but wasteful. |
| U-2 | P2 | **Player on a phone**: the question palette sits below the fold; the action row wraps into three lines. Candidates cannot see progress/palette at a glance. |
| U-3 | P3 | `/favicon.ico` 404 on every page (console error on every route); `/users` logs a second console error. |
| U-4 | P3 | Examiner `/results` has no h1/h2 (may use another level) — heading structure inconsistent with sibling pages. |
| U-5 | P3 | Notification deep links go to non-existent routes (`04`). |
| U-6 | P2 | No error/not-found/loading boundaries; a crashed page shows the framework default. |
| U-7 | P3 | Examiner bell shows **22** notifications in the clean seed after the e2e run (accumulated, no grouping/clear UI observed). |

## Not assessed

- Accessibility conformance: no axe/WCAG run, no screen-reader or keyboard-only pass, no colour-contrast measurement (the crimson-on-ivory and green pill contrasts were not computed). Automated checks were limited to labels, alt text and overflow. **Score: NOT_ASSESSED beyond that.**
- Visual regression, dark mode, print styles of the certificate, localisation (Urdu/RTL).
- Mobile/tablet *behaviour* of staff flows (monitor `+ Time`, override dialog) — only rendering.
- The uploaded university reference deck was not available to compare against; the palette in `globals.css` matches the specified hex values only by inspection of tokens (`design-system.md`), not measured from pixels.
