# 20 — Cross-role consistency

| Component | Consistent? | Notes |
|---|---|---|
| Shell, menu, breadcrumb, bell, sign-out | yes (except blank crumbs on non-menu routes) | |
| Status badges | yes — same chip component; colours consistent (green live/pass, amber pending/skipped, grey draft/absent, red fail) | "Cancelled" reused for inactive (UI-002) |
| Examination list | one page for 6 roles, role-agnostic subtitle (UI-049) | different roles see different buttons (good) |
| Student list | Campus Admin "Scoped to DMC-A"; others "All institutions" with an institution filter — consistent search; no per-role actions | |
| Result table | student view (own) vs exam record results panel (campus-filtered) — different columns; no shared pattern | acceptable (different tasks) |
| Notifications | one component; links role-aware only partly (UI-031) | |
| Profile | identical for all roles; MFA card for staff | |
| Search | per-list; same debounce; none global | |
| Filters | selects; no clear; not in URL | UI-028 |
| Confirmation dialogs | `Confirm`/`Modal` shared (consistent), but Deactivate/End attempt skip it | UI-025/029 |
| Date format | "01 Nov 2026 13:27" everywhere (good); time zone not shown | |
| "Completed" | student tile = published results; staff have no equivalent | rename (doc 04) |
| Back navigation | browser Back only; no in-page "back to list" | |
| Campus context | text only, bottom of sidebar | UI-050 |
| Permission failures | three patterns | UI-018 |
| Empty states | one pattern (grey sentence) | no next action |
Different behaviour that is *justified*: the player has its own chrome (no sidebar) — correct for a focused task; the control centre is a full page (not a modal) — correct.
