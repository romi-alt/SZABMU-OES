# 09 — Remaining issues

1 NOT_STARTED, 5 REQUIRES_POLICY_DECISION, 12 FIXED_NOT_FULLY_TESTED.

- **UI-011** (P2) Global — Muted text token (--ink-3 #8A7A77) — FIXED_NOT_FULLY_TESTED. Not re-measured on every tinted background; axe not re-run across all 197 loads
- **UI-013** (P2) Dialogs — Modal component — FIXED_NOT_FULLY_TESTED. No dedicated Modal unit spec
- **UI-022** (P2) Navigation — Routes reachable but not in the menu — REQUIRES_POLICY_DECISION. Whether hidden-but-reachable routes should be added to menus or blocked is a product/permissions decision (docs/route-permissions.md).
- **UI-023** (P2) Dashboards — Tile-only dashboards — NOT_STARTED. Open: see audit register UI-023
- **UI-024** (P2) Staff & accounts — Account list — FIXED_NOT_FULLY_TESTED. Destructive buttons (Deactivate, Reset password) in this list are still unconfirmed
- **UI-030** (P2) Control centre — Dialog confirm labels — FIXED_NOT_FULLY_TESTED. No spec asserts the new wording
- **UI-031** (P2) Notifications — Notification panel — FIXED_NOT_FULLY_TESTED. No per-event grouping or pagination; API still returns the latest 100
- **UI-034** (P2) Student list — Row actions / detail — REQUIRES_POLICY_DECISION. Adds a new student detail screen — new feature, needs scope approval.
- **UI-035** (P2) Lecturer portal — Menu/dashboard — REQUIRES_POLICY_DECISION. Lecturer portal content is a product decision.
- **UI-036** (P2) Exam header — Sticky header — FIXED_NOT_FULLY_TESTED. Measured at 390 px only; 200 % zoom at 640×360 not re-measured
- **UI-037** (P2) Charts/tiles — aria-pressed on non-interactive chips — FIXED_NOT_FULLY_TESTED. Other remaining aria-pressed uses are real toggle buttons (kept); not re-audited with axe
- **UI-039** (P3) Auth pages — Layout at 360–390 px — FIXED_NOT_FULLY_TESTED. The 401 console probe on public pages (second half of the finding) is NOT addressed; verify page not re-tested
- **UI-041** (P3) Long clinical stems — Question layout on phones — FIXED_NOT_FULLY_TESTED. Page is still long for very long vignettes
- **UI-042** (P3) Results vs Performance — Consistency — REQUIRES_POLICY_DECISION. Needs a decision on which of Results/Performance is authoritative.
- **UI-043** (P3) Tables — Semantics — FIXED_NOT_FULLY_TESTED. No dedicated axe re-run; row headers not added
- **UI-046** (P3) Design system — Tokens — FIXED_NOT_FULLY_TESTED. Most sizes remain px
- **UI-050** (P3) Global chrome — Top bar — REQUIRES_POLICY_DECISION. Global search/help is a new feature.
- **UI-052** (P3) Long answer options — Option cards on phones — FIXED_NOT_FULLY_TESTED. Extreme fixtures not re-measured

Suggested next batch: UI-016 button set, remaining list pages for URL state, then, then the P3 mobile/tokens set.
