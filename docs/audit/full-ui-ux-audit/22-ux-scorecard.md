# 22 — UX scorecard

Scale 0–10 (0 = unusable, 5 = works with notable friction, 8 = good with polish left, 10 = exemplary). Scores reflect **evidence gathered in this audit only**; areas that need real users, devices or assistive technology are marked in the "not assessed" list rather than scored high. The average is deliberately not reported as a single figure.

| # | Area | Score | What works | What fails | Issues | To reach the stated score |
|---|---|---|---|---|---|---|
| 1 | Overall navigation clarity | **6** | Short role menus, correct active states, drawer on mobile, deep-linked dashboard tiles (CCE). | Label ≠ title (5), hidden-but-reachable routes (7 roles), Campus Admin without Live monitor, a crashing menu item, blank breadcrumbs, no search/context. | UI-006, 021, 022, 001, 050 | Fix labels/menus; add context chip and monitor entry → 8 |
| 2 | Information architecture | **5** | Exam record ↔ control ↔ monitor cross-linking; role-appropriate shells. | People management split in 4 places, 3 names for campus, student record missing, lecturer/campus admin portals thin. | doc 04; UI-034/035 | Student record, courses page, vocabulary → 7 |
| 3 | Student dashboard usability | **5** | Clean, 4 tiles, shows programme and reg. number. | Wrong "Opens" time for live exams, indirect CTA, 3 clicks to start, silent ineligibility. | UI-007, 008, 051 | Live-now card with Start → 8 |
| 4 | Student live examination experience | **7** | Autosave confirmation, sticky timer/Review, offline resilience, protected submission, shortcuts, honest failure text. | Hung save never escalates, review locks ~20 s on failed saves, palette clipping, colour-only states, Clear without undo. | UI-003, 004, 005, 014, 015 | Fix the four P1/P2 → 9 |
| 5 | MCQ navigation | **6** | One-click jump on desktop, filter chips, ring on current question, keyboard shortcuts. | Palette not sticky (66/100 on 1280×720), 86 Tab presses to Q87, 3–4 interactions on phones, role=listitem. | UI-005, 012, 017 | Sticky palette + jump field → 8 |
| 6 | Save and status communication | **6** | "✓ Saved" only after server ack; offline banner; persistent "Not yet saved — retrying". | Hang = "Saving…" forever; 500/409 show 12 px text only; no per-question unsaved marker in palette. | UI-003, 004 | Timeout + banner + palette badge → 9 |
| 7 | Examination review/submission UX | **7** | Counts by state, jump buttons, plain-language confirmation with checkbox, single final step, far from routine buttons. | Blocked review when saves fail, focus not in dialog, "Skipped/Unanswered/Not visited" jargon. | UI-004, 013, 016 | Open review immediately → 9 |
| 8 | Lecturer portal usability | **4** | Question editor logical; course scoping enforced; row-level Submit. | No My courses/grading/materials, no rejection feedback, disabled Save without reason, dead-end /schedule. | UI-035, 026, 018 | Assigned-courses page + feedback → 7 |
| 9 | Examiner portal usability | **5** | Deep-linked approval flow, status filter, read-only control centre with explanation. | Sparse dashboard, 14-field modal, 110-row paper checklist, permission-blind buttons, wrong scope text. | UI-023, 026, 027, 019, 020 | Paper builder + dashboard lists → 7 |
| 10 | Live control room usability | **7** | Complete command set, reason fields, preview-before-apply, campus table, disconnected tile + warning, live push indicator. | Close/Close/Force ambiguity, jargon labels, no disconnected filter, operator-level health panel. | UI-030, 029 | Rename + filter → 9 |
| 11 | Campus dashboard usability | **3** | Counts are correct and scoped to campus. | Attendance/eligibility page crashes, monitor not in menu, no student record, mixed accounts list, tile semantics. | UI-001, 006, 034, 024, 023 | Fix crash + monitor + student page → 6 |
| 12 | Super Admin usability | **5** | Complete CRUD surfaces, linked dashboard, modal forms short. | Deactivate unconfirmed and corrupting data, no edit, no permissions/settings, audit jargon. | UI-002, 025, 038 | Confirm + edit + readable audit → 7 |
| 13 | Forms | **5** | Labels above fields, sensible defaults, Cancel/✕ everywhere. | No required markers/inline validation/unsaved warning; disabled buttons unexplained; modal heights. | UI-026, 032 | Inline validation → 8 |
| 14 | Data tables | **6** | Consistent, scannable, mono numerals, chips, responsive cards, pagination counts. | No sort/captions/scope, repeated row-button names, audit columns. | UI-043, 029, 038 | Semantics + sort → 8 |
| 15 | Search and filtering | **4** | Search where needed, placeholders state scope, counts update. | State lost on Back, no URL state, no clear, no global search, no echo on empty. | UI-028, 050 | URL state + clear → 7 |
| 16 | Mobile responsiveness | **7** | No overflow on any authenticated page at 360–1600 px; drawer; card tables; palette sheet; sticky timer. | Header 168 px on phones, 3–4 taps to jump, 2 px overflow on public pages, ≥ 44 px targets not met everywhere, no real-device test. | UI-017, 036, 039 | Compact header + jump field → 8 |
| 17 | Accessibility | **4** | Names on all 3,399 controls, visible focus, radiogroup, lang, labelled inputs, no flashing, reduced-motion. | Contrast token (154 pages), no skip link, identical titles, modal focus, listitem buttons, colour-only states, table semantics. No AT test. | UI-009–014, 037, 043–047 | Fix listed items + AT test → 7 |
| 18 | Visual consistency | **7** | Restrained institutional palette matching the brief, one component kit, consistent shell. | 11 radii, 13 font sizes, 101 inline styles, crimson = primary and danger. | UI-046 | Token consolidation → 8 |
| 19 | Error and recovery experience | **6** | Friendly 500 card, offline handling, branded 404, session-expiry redirect, no technical leakage. | Hung requests, three permission patterns, crash on /enrolment, "Reconnecting" on 404. | UI-018, 033, 001, 020 | Timeouts + one 403 page → 8 |
| 20 | Overall task efficiency | **5** | CCE approval 3 clicks; student start 3 clicks; control commands 2–3 steps. | Exam creation ≥ 8 steps/3 roles with no guidance; 100-click paper build; attendance journey impossible. | doc 13 | Wizard + filters → 7 |

## NOT_ASSESSED (no evidence available)

- Manual grading UI and course-materials UI (not implemented).
- Screen-reader experience (NVDA/JAWS/VoiceOver), voice control, high-contrast mode.
- Real-device mobile behaviour (iOS/Android keyboards, orientation).
- 200-question palette (fixture limit), real exam-day load, Urdu/RTL content, print layout of the certificate.
- Candidate reset-password screen (not reached), MFA enrolment flow in this run.

Highest-impact path: fix the four exam-player P1s (UI-003/004/005 + palette semantics), the enrolment crash (UI-001), and the data-integrity PATCH (UI-002) — together they lift areas 4, 5, 6, 7, 11 and 12 by 1–2 points each.
