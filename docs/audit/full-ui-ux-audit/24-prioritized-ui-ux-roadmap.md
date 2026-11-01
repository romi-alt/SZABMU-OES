# 24 — Prioritised UI/UX roadmap

Order follows the brief (exam-player safety first), adapted to verified risk. 52 issues: P1 8, P2 31, P3 13. Effort: S ≤ 2 days, M ≈ 1 week, L > 1 week (relative, single developer). "Quick improvements" are items 1–3, 7, 8 (mostly frontend, few dependencies); "architectural" items are 4 (paper builder), 5 (student record/attendance) and the navigation redesign in doc 23.

| # | Theme | Issue IDs | Source components | Proposed changes | Dependencies | Effort | Regression risk | Acceptance tests |
|---|---|---|---|---|---|---|---|---|
| 1 | Exam-player safety and clarity | UI-003, 004, 005, 012, 013, 014, 015, 016, 017, 036, 040, 041, 052 | exam/[examId]/page.tsx, exam-engine.ts, api.ts, globals.css (.pal, .exam-bar), ui.tsx Modal | request timeout + unsaved banner; non-blocking review with retry; sticky scrollable palette + jump field + next-unanswered; palette semantics/glyphs; undo for Clear; focus management in Modal; rename Save & next | none (all frontend; engine already keeps unsaved answers) | M | engine save path is the most sensitive code — add Playwright fault tests (hang/500/409) first | hang/500 specs, sticky palette measurement at 1280×720, axe focus test |
| 2 | Broken or misleading primary navigation / data integrity | UI-001, 002, 006, 021, 022, 025, 018, 019 | enrolment/page.tsx, api.ts, ui.tsx Async/Table, org.controller.ts, nav.ts, institutions/page.tsx | fix useGet(null)+Async; true-partial institution PATCH + regression test; add Live monitor to Campus Admin; one ForbiddenPage and `can()`-gated buttons; Confirm on Deactivate; label alignment | API test for PATCH; permission map | S–M | low; add the missing Playwright specs for /enrolment and institutions | /enrolment renders for admin.a; PATCH test; nav-label=title test |
| 3 | Student dashboard and exam-day workflow | UI-007, 008, 051, 042, 048 | dashboard/page.tsx, schedule/page.tsx, me/exams API | live-now card, status-aware time column, ineligible reason rows, certificate error state | API returns availability/closing/eligibility reason | S–M | schedule logic shared with Start button — keep canStart authoritative | status-matrix unit test; a001 view test |
| 4 | Examiner control and scheduling usability | UI-026, 027, 029, 030, 020, 023, 049 | exams/page.tsx, exams/[id]/page.tsx, control/page.tsx, monitor page | paper builder with filters/totals; required markers + inline validation; control labels; monitor scope text; "needs attention" lists | API filters for approved questions | M–L | moderate (paper builder changes data entry) | build 100-question paper in < 10 interactions |
| 5 | Campus administration efficiency | UI-034, 024, 023, 006 | students/page.tsx, users/page.tsx, new student page | student record + attendance register (design first), staff-only accounts default, campus "Today" dashboard | attendance data model (known gap D-07) | L | new data model | Journey G ≤ 4 steps |
| 6 | Lecturer authoring and grading | UI-035, 026 | nav.ts, dashboard, questions/page.tsx | My courses page; submit-from-editor; rejection feedback; role-specific copy | course assignment API | M | low | lecturer sees assigned courses first |
| 7 | Mobile/tablet | UI-017, 036, 039, 052 | globals.css, exam header | compact header; jump field; sticky action bar; 2 px overflow | depends on 1 | S | low | ≤ 2 interactions to any question at 360×640 |
| 8 | Accessibility | UI-009, 010, 011, 037, 043, 044, 045, 047 | layout.tsx, globals.css, ui.tsx Table, metadata | skip link, titles, --ink-3, table captions/scope, chips, landmarks, control borders; screen-reader pass | none | S–M | contrast change touches every page (visual regression) | axe 0 serious/critical; AT test report |
| 9 | Visual consistency | UI-046 | globals.css, 101 inline styles | token scale, rem type, remove inline styles, distinct danger colour | none | M | wide visual surface | token audit script |
| 10 | Secondary refinements | UI-028, 031, 032, 033, 038, 042, 049, 050 | various | URL filter state, notification grouping, phone validation, slow-load message, readable audit, context chip, global search | some API work | M | low | per issue acceptance |

## Suggested sequence for the next implementation session

1. Add failing tests first: Playwright for `/enrolment` (Campus Admin), exam-player hang/500 save, PATCH institution API test, nav-label=title, no-sideways-scroll already exists.
2. Fix theme 2 (small, high value, includes a data-integrity bug) then theme 1.
3. Theme 3 together with the API change for availability/eligibility reasons.
4. Accessibility quick wins (skip link, titles, contrast token).
5. Re-run this audit's crawl (`tools/`) and compare counts: axe contrast pages 154 → 0; overflow loads 0; unnamed controls 0; role-mismatch patterns 3 → 1.

Not recommended: a rewrite, a new UI framework, new colours, gradients or decorative cards.
