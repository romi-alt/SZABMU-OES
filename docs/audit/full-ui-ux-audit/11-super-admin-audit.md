# 11 — Institution / Super Administrator portal

Account super.admin. Evidence `evidence/admin/`.

| Reference page | Status |
|---|---|
| University dashboard | EXISTING — Institutions 3 · Users 91 · Students 80 · Exams 7 · Audit entries 467 (all linked); "Users 91" includes the 80 students; no system health on the dashboard |
| Institution list / Add / Edit | list + "+ Register institution" (modal: Code "Capitals, digits, hyphen", City, Name, Type, Affiliation); **no edit**, only Activate/Deactivate; **PATCH bug resets affiliation (UI-002)**; no confirmation (UI-025); inactive shown as "Cancelled" |
| Affiliation records | one column ("constituent"/"affiliated"); no parent/child structure |
| Campuses / departments / sessions | not separate screens |
| Programs | read-only list by programme (BSN, MBBS) |
| Student management | list/search/import/add — no detail view (UI-034) |
| Staff & role assignment | "+ New account": Full name, Email, Role (6 options), Institutions (multi-select, campus-scoped roles) → Create. **No Institution Administrator role exists** |
| User permissions | **absent** — no permission matrix screen (reference deck page 26 shows RBAC toggles) |
| All examinations | Examinations list (same page as other roles) |
| Notifications / System settings | settings page **absent** (reference page 28) |
| Reports | none |
| Audit logs | `/audit` (a04): columns #, When, Action, Role, Entity, Detail, Hash; entity filter + "Action starts with"; "Verify chain integrity" (a crimson-outline button) — technical wording and raw ids (UI-038) |

**Is the hierarchy obvious?** Not visually: a flat list of three institutions. **Institution vs campus** — one concept with three names (doc 04). **Is creating a campus understandable?** The modal is short and the code hint is helpful; there is no success confirmation beyond the new row and no next step ("now add an administrator"). **Is user-role assignment safe?** Role and campuses are chosen in one dialog; there is no summary of what the role can do and no confirmation. **Are dangerous controls isolated?** No — "Deactivate" sits next to the row and runs immediately (UI-025).

**Technical detail exposed to ordinary staff:** audit raw tokens, "Operational health" names (outbox, lifecycle worker), "Reconcile attempts", "Initiate scoring", "four-eyes principle" in an error toast.
