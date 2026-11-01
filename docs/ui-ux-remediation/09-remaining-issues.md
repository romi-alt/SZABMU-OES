# 09 — Remaining issues

18 NOT_STARTED, 5 REQUIRES_POLICY_DECISION, 7 FIXED_NOT_FULLY_TESTED.

- **UI-011** (P2) Global — Muted text token (--ink-3 #8A7A77) — FIXED_NOT_FULLY_TESTED. Not re-measured on every tinted background; axe not re-run across all 197 loads
- **UI-013** (P2) Dialogs — Modal component — FIXED_NOT_FULLY_TESTED. No dedicated Modal unit spec
- **UI-016** (P2) Question actions — Save & next / Skip / Next — FIXED_NOT_FULLY_TESTED. Button set unchanged; only the count wording is addressed
- **UI-022** (P2) Navigation — Routes reachable but not in the menu — REQUIRES_POLICY_DECISION. Whether hidden-but-reachable routes should be added to menus or blocked is a product/permissions decision (docs/route-permissions.md).
- **UI-023** (P2) Dashboards — Tile-only dashboards — NOT_STARTED. Open: see audit register UI-023
- **UI-024** (P2) Staff & accounts — Account list — FIXED_NOT_FULLY_TESTED. Destructive buttons (Deactivate, Reset password) in this list are still unconfirmed
- **UI-026** (P2) Forms — Create/Save buttons — NOT_STARTED. Open: see audit register UI-026
- **UI-027** (P2) Paper builder — Question picker — NOT_STARTED. Open: see audit register UI-027
- **UI-028** (P2) Search / filter / pagination — List state — NOT_STARTED. Open: see audit register UI-028
- **UI-030** (P2) Control centre — Dialog confirm labels — FIXED_NOT_FULLY_TESTED. No spec asserts the new wording
- **UI-031** (P2) Notifications — Notification panel — FIXED_NOT_FULLY_TESTED. No per-event grouping or pagination; API still returns the latest 100
- **UI-033** (P2) Loading states — Async/Loading — NOT_STARTED. Open: see audit register UI-033
- **UI-034** (P2) Student list — Row actions / detail — REQUIRES_POLICY_DECISION. Adds a new student detail screen — new feature, needs scope approval.
- **UI-035** (P2) Lecturer portal — Menu/dashboard — REQUIRES_POLICY_DECISION. Lecturer portal content is a product decision.
- **UI-036** (P2) Exam header — Sticky header — NOT_STARTED. Open: see audit register UI-036
- **UI-037** (P2) Charts/tiles — aria-pressed on non-interactive chips — NOT_STARTED. Open: see audit register UI-037
- **UI-038** (P2) Audit trail — Table — NOT_STARTED. Open: see audit register UI-038
- **UI-039** (P3) Auth pages — Layout at 360–390 px — NOT_STARTED. Open: see audit register UI-039
- **UI-040** (P3) Entry — Reload behaviour — NOT_STARTED. Open: see audit register UI-040
- **UI-041** (P3) Long clinical stems — Question layout on phones — NOT_STARTED. Open: see audit register UI-041
- **UI-042** (P3) Results vs Performance — Consistency — REQUIRES_POLICY_DECISION. Needs a decision on which of Results/Performance is authoritative.
- **UI-043** (P3) Tables — Semantics — FIXED_NOT_FULLY_TESTED. No dedicated axe re-run; row headers not added
- **UI-044** (P3) Global — Bell accessible name — NOT_STARTED. Open: see audit register UI-044
- **UI-045** (P3) Global — Landmarks / headings — NOT_STARTED. Open: see audit register UI-045
- **UI-046** (P3) Design system — Tokens — NOT_STARTED. Open: see audit register UI-046
- **UI-048** (P3) Certificate — Error state — NOT_STARTED. Open: see audit register UI-048
- **UI-049** (P3) Examinations list — Columns and copy — NOT_STARTED. Open: see audit register UI-049
- **UI-050** (P3) Global chrome — Top bar — REQUIRES_POLICY_DECISION. Global search/help is a new feature.
- **UI-051** (P2) Eligibility feedback — Empty state for an excluded candidate — NOT_STARTED. Open: see audit register UI-051
- **UI-052** (P3) Long answer options — Option cards on phones — NOT_STARTED. Open: see audit register UI-052

Suggested next batch: UI-026/027/028 (forms, paper picker, list state), UI-016 button set, then, then the P3 mobile/tokens set.
