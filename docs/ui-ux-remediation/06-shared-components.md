# 06 — Shared components changed
| Component | Change | Issues |
|---|---|---|
| `useGet` (api.ts) | explicit idle/loading/settled contract | UI-001, 033-part |
| `Async`, `Table` (ui.tsx) | `idle` prop; non-array notice; `scope="col"`; named action column | UI-001, 043 |
| `Modal` | focus in, trap, Escape/backdrop, restore, "Dismiss dialog" | UI-013 |
| `PageHead` | sets document title | UI-010 |
| `Field` | error text `role=alert` | UI-032 |
| `Confirm` (existing) | now used for institution deactivation | UI-025 |
| Palette (new) | accessible navigator | UI-005, 012, 014, 017 |
| `exam-status` model (shared) | single status derivation | UI-007, 008 |
| `isValidPhone` (shared) | phone format | UI-032 |
