# 25 — Ready-to-execute implementation prompt (NOT executed)

```
You are continuing the SZABMU/PIMS Online Examination System on branch claude/oes-platform-foundation
(repo romi-alt/SZABMU-OES). Read docs/audit/full-ui-ux-audit/ first: 00-coverage-and-evidence-check.md, 21-complete-issue-register.md,
24-prioritized-ui-ux-roadmap.md and 23-proposed-navigation-redesign.md. Evidence rules: label TODAY / HISTORICAL / NOT RUN;
never claim an issue fixed without the acceptance test in the register passing; synthetic data only; do not touch the shared
development database (:5433) or Redis (:6390) — run browser tests only against a disposable stack
(/tmp/stab-stack.sh start; export the vars from /tmp/stab-env.sh; npm run db:migrate -w @oes/api; seed with SEED_STUDENTS_PER_CAMPUS=8);
no merge to main, no PR, no deployment. One logical commit per theme; tests first; run lint, typecheck, build, API tests and the
full Playwright suite twice before each push; update docs/implementation-status.md.

THEME A — data integrity and broken navigation (UI-001, 002, 006, 018, 019, 021, 025):
 1. Write failing tests: Playwright /enrolment as admin.a (renders, no console error) and as student (permission page);
    API test: PATCH /institutions/:id {active:false} leaves affiliation unchanged; test that nav label equals page h1.
 2. Fix useGet(null)/Async/Table null handling; make the institution update schema a true partial; rename inactive status;
    add Live monitor to the Campus Admin menu; introduce one ForbiddenPage driven by the permission map and gate buttons with can();
    wrap Deactivate in the existing Confirm; rename menu labels per doc 03 §6.
THEME B — exam-player safety (UI-003, 004, 005, 012–017, 036):
 1. Playwright fault tests with route interception: save never answers; save returns 500/409; assert indicator changes ≤ 12 s,
    a banner shows the unsaved count, Review & submit opens immediately and lists unsaved questions with a Retry action.
 2. Add request timeouts (AbortController ≈ 10 s) in api.ts/exam-engine; non-blocking review; per-question unsaved badge in the palette;
    sticky, scrollable palette column (measure ≥ 100/100 reachable at 1280×720 without moving the question); "Go to question #" and
    "Next unanswered"; remove role="listitem"; palette glyphs for non-colour states; undo toast for Clear response; focus into/trap/return
    in Modal; rename "Save & next" to "Next"; compact phone header (≤ 15 % of height at 360×640).
THEME C — student exam-day clarity (UI-007, 008, 051, 042, 048): API returns availability, closesAt and an eligibility reason;
 dashboard "Live now" card with Start; status-aware time column; excluded students see the exam with a reason and contact.
THEME D — accessibility quick wins (UI-009, 010, 011, 037, 043–045, 047): skip link, per-route titles, darker --ink-3 (≥ 4.5:1),
 table caption/scope, real buttons for chips, one <main> in the player, control border contrast.
After each theme: re-run tools/crawl-all-roles.mjs (docs/audit/full-ui-ux-audit/tools) and report the before/after numbers
(axe contrast pages 154, overflow loads 0, role-mismatch patterns 3, identical titles 197).
FINAL REPORT: git status, commit hashes, push confirmation (branch only), files changed, tests with exact counts and exit codes
(TODAY vs HISTORICAL), unresolved risks. Do not claim pilot readiness.
```
