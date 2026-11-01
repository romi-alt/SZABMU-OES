# 09 — Examiner, Controller (CCE) and the live control centre

Accounts: examiner, cce, super.admin. Evidence `evidence/examiner/`, `evidence/admin/a07–a10`.

## 1. Exam creation and scheduling workflow
Statuses (filter options): DRAFT → PAPER PENDING → APPROVED → SCHEDULED → LIVE → CLOSED → RESULT PENDING → PUBLISHED (+ CANCELLED).

| Step | Who | Where | Observed |
|---|---|---|---|
| Create exam | Examiner | /exams → "+ New examination" modal | **14 fields in one modal** (title, code, course, term, opens, closes, duration, pass mark, negative marking, campus checkboxes, shuffle, instructions); "Create draft" disabled until valid, no required markers or inline errors (UI-026). Campuses are checkboxes — multi-campus scheduling is possible |
| Build paper | Examiner | exam record → question checklist | 110-row unfiltered checklist; no search/filter/select-all/totals (UI-027) |
| Submit for approval | Examiner | "Submit for approval" (disabled until questions chosen) | clear |
| Approve paper | CCE (not the submitter) | dashboard tile "Papers to approve 1" → /exams?status=PAPER_PENDING → record → "Approve paper" | **3 clicks, deep-linked — good**; four-eyes enforced with a visible notice; the button is nevertheless enabled for the submitter (UI-019) |
| Schedule | Examiner | "Schedule" on record | no summary/confirmation screen of what will be scheduled |
| Approve suspension-clock policy | CCE | control centre | the exam is visibly "Suspension clock: Not approved — suspension is unavailable…" (clear) |
| Open admission → Start | CCE | control centre | see §3 |

There is **no wizard or progress strip** telling the creator what comes next, who must act and what state the exam is in; the next action must be discovered from the status chip. At least 8 steps across 3 roles and 4 pages (create → paper → submit → approve → schedule → policy → admission → start).

## 2. Examiner screens
- **Dashboard** (`e01`): four tiles only — Questions to review 1 · Papers pending 1 · Live exams 3 · Results to approve 0; no lists, no quick actions (UI-023). The reference deck shows a schedule form and approval queue here.
- **Examinations list** (`e02`): columns Code, Title, Course, Opens, MIN, QS, Candidates, Status, Open ›; status filter; Opens shows the *planned* window even for exams started manually (UI-049).
- **Question bank for review** (`/questions`): same page as lecturer with "+ New question" and Edit; reviewing/approving happens in the edit modal or exam record? (approval buttons for questions not exercised — NOT VERIFIED beyond list).
- **Control centre for the examiner** (`e05`): everything visible but disabled with the sentence "You can monitor this examination; commands are available to the Controller of Examinations and Super Administrator." — a **good, explicit read-only pattern** (disabled buttons also carry `title` reasons such as "Admission is already open", "Nothing is suspended").
- **Live monitor**: Live exams list → `Monitor ›` (e09). Subtitle "Your campus only." is wrong for examiners (UI-020).

## 3. Live control room — can the controller see what matters? (`a07-control-centre.jpg`)
| Need | Present? |
|---|---|
| Which exam is active | title + status chip ("Live"), state chips (Individual attempt timing · Manual control · Paper hash · Started …), freshness "Live (push)" |
| Active students | tiles: Allocated, Eligible, Admitted (entered) with %, In progress, Online/Disconnected (e.g. "5 / 2"), Submitted, Auto-submitted, Remaining, Active incidents |
| Disconnected | tile + campus-table column + warning chip ("2 of 5 candidates disconnected") — **but the candidate filter has no "disconnected" option** (Status: not started / in progress / suspended / submitted / auto submitted); the controller must scan the Connection column |
| Submission progress | Submitted/Auto-submitted/Remaining tiles; campus table "0/39" |
| Affected campuses | Campuses table with per-campus eligible/attendance/in progress/disconnected/submitted/incidents/warning |
| Critical incidents | Active incidents tile (links to /incidents) |
| Deadline | "Deadline" column per candidate; exam window in header |
| System health | "Operational health" table: lifecycle worker, expired attempts awaiting seal, event outbox, Redis, live connections, answer-write p95, API errors — excellent for operators, **too technical for most staff** (names like "event outbox") |

### Command inventory (labels, scope, confirmation, reason, feedback)
| Button | Enabled when | Dialog text (observed) | Scope | Reason | Verdict |
|---|---|---|---|---|---|
| Open admission | exam approved/scheduled | — (disabled when already open: tooltip) | exam | — | clear |
| Close admission | admission open | "No new attempts can start. Candidates already admitted keep every right: saving, resuming and submitting." Confirm: **Close admission** | exam | no | good: states what continues |
| Start examination | before start | not opened (disabled) | exam | — | — |
| Suspend… | live | Scope (Entire / One campus cohort / Selected candidates), Reason ≥ 10 chars, clock policy text, checkbox "I confirm this suspension." Confirm: **Suspend** | selectable | **required** | strong; policy text explains time effect |
| Resume… | suspended | not exercised (disabled) | | | |
| Extend time… | live | scope, minutes 1–240, reason, **"Preview effect"** then checkbox "I approve this extension and have reviewed the effect above." Confirm: **Apply extension** | selectable | required | excellent pattern (preview-before-apply) |
| Close examination… | live | "Admission closes. Candidates still working finish at their own deadlines, then the examination becomes Closed." + checkbox "Force-close: seal every remaining attempt now (n in progress)". Confirm label **Close** | exam | required only when force | **ambiguous** — confirm button "Close" has the same name as the dismiss ✕ (aria-label "Close") and the force box changes the meaning of the same button (UI-030) |
| Reconcile attempts | any | "Seals attempts whose database-derived deadline has passed (the same pass the background worker runs). Safe to repeat." | exam | no | jargon but safe |
| Initiate scoring | closed | not exercised | | | jargon ("Start marking") |

Dangerous ambiguity check: **Close admission / Close examination / Force-close / Suspend** — the first two share a verb; the force-close is a checkbox inside the second; Suspend is distinct. Colours: Suspend… and Close examination… are crimson text on white; "Control centre" on the exam record is a solid crimson button — crimson means both *primary* and *danger* (UI-046). Recommended verbs in doc 03 §6.

## 4. Incidents
Report dialog (`e12`): title "Report incident — DMC-A-2024-0002" (names the candidate), Type (6 options), Severity (LOW/MEDIUM/HIGH), Description "(min. 10 characters)", Cancel / **File report** — a good pattern. The Incidents page lists reports with a Status filter (empty in the clean fixture, so row actions Add note / Update incident were not exercised). There is no "Report incident" entry on /incidents itself — reporting starts from a monitor row.
