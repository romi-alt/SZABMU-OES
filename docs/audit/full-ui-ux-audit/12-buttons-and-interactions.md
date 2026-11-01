# 12 — Buttons and interactions

**Inventory:** 3,399 visible interactive controls extracted from 197 authenticated loads (links, buttons, inputs, selects, textareas, role=button/tab/radio). Zero controls had an empty accessible name and none was icon-only (the UI is text-labelled throughout — a strength). Focus ring present on every tab stop tested (0 stops without outline/shadow).

## Control mix

| Kind | Count |
|---|---|
| a | 1,437 |
| button | 1,325 |
| input:checkbox | 366 |
| input:number | 117 |
| input | 65 |
| select | 61 |
| input:password | 21 |
| button:button | 7 |

## Controls actually exercised (clicked/typed) in this audit

| Control | Role | Result | Verdict |
|---|---|---|---|
| Sidebar nav (all items) | all 7 | every item navigates; active state follows; Enrolment & eligibility crashes | UI-001 |
| "Go to schedule" → "Start →" → "Begin examination →" | Student | 3 clicks from dashboard to timer | UI-007/008 |
| Option A–E, keyboard c, ArrowRight, Skip, Next, Mark, Clear response | Student | all work; Clear has no confirm | UI-015/016 |
| Palette button 87 of 100 | Student | 1 click (desktop), 2–4 interactions on phones | UI-005/017 |
| Review & submit → Submit examination… → checkbox → Confirm and submit | Student | confirm disabled until ticked (good); focus not moved into dialog | UI-013 |
| Deactivate / Activate institution | Super Admin / Examiner | immediate action; examiner gets 403 toast; affiliation reset side effect | UI-002/019/025 |
| + Register institution (valid data) | Examiner | 403 toast, modal stays open | UI-019 |
| Approve paper (own paper) | Examiner | toast "four-eyes principle" | UI-019 |
| Control centre: Close admission, Suspend…, Extend… (+Preview), Close examination…, Reconcile attempts | CCE | dialogs open; copy reviewed; cancelled (not confirmed) | UI-030 |
| + New examination, + New question, Edit, + New account, + Assign lecturer | Examiner/Lecturer/Super Admin | forms open; submit disabled until valid | UI-026 |
| Report (incident) | Invigilator | dialog names candidate, 10-char minimum | good pattern |
| Students search, no-result, Next | Super Admin | works; state not in URL | UI-028 |
| Status filter on exams | Examiner | works | — |
| Bell panel and 2–6 notification links per role | Student, Examiner, Lecturer | links resolve except examiner /results | UI-031 |
| Profile Save changes with phone "abc" | Student | "Profile saved" | UI-032 |
| Clear cookies then click a nav link | Campus Admin | returns to /login (good); after re-login lands on /dashboard, not the requested page | UI-018 note |
| Certificate › → Print certificate | Student | opens certificate; Print present | — |

## Controls NOT exercised (reason)

Row actions that change data and were judged unnecessary to execute: Deactivate/Reset password (users), Revoke (assignments), Withdraw…/Admit… and Set extra time (roster), + Time / End (monitor), Condone… (blocked by UI-001), Import CSV / Add student, Export CSV, "Verify chain integrity", incident status/notes (no incidents in the clean fixture), bulk checkboxes on the control page, Mark all read, Print (browser dialog), TOTP enrolment (MFA off), password change submit. Their labels, positions and permission visibility were inspected from the DOM only.

## Findings by category

**DEAD BUTTONS:** none found among clicked controls (every clicked control produced an action or a refusal).  
**MISLEADING / PERMISSION-BLIND BUTTONS:** UI-019 (Register institution, Deactivate, Approve own paper).  
**DUPLICATE BUTTONS:** two "Sign out" buttons on Profile (UI-032); identical row buttons repeated per row (below).  
**HIDDEN PRIMARY ACTIONS:** Live monitor missing from Campus Admin menu (UI-006); control-centre shortcut only inside exam detail.  
**AMBIGUOUS LABELS:** "End", "+ Time", "Report", "Edit", "Close" (UI-029/030).  
**CONFUSING CONFIRMATIONS:** Deactivate has none (UI-025); submit confirmation is good.  
**MISSING CANCEL:** none; every modal has Cancel and ✕.  
**INCONSISTENT SAVE BEHAVIOR:** profile saves with a toast, modals close on success, question editor needs a separate row button to submit (works, but undiscoverable).

## Repeated identical control names on one page (> 3 occurrences)

| Page | Control name | Times |
|---|---|---|
| `/exams/:id` | Withdraw… | 78 |
| `/exams/:id` | Set | 78 |
| `/monitor/:id` | Report | 50 |
| `/questions` | Edit | 25 |
| `/users` | Deactivate | 25 |
| `/users` | Reset password | 25 |
| `/exams` | Open › | 7 |
| `/assignments` | Revoke | 4 |

## Touch-target size (controls < 44 × 44 CSS px, summed over all loads)

| Viewport | Controls under 44 px |
|---|---|
| 1440 px | 2,983 |
| 768 px | 1,887 |
| 390 px | 1,967 |

_Note: 44 px is the AAA/Apple guideline; WCAG 2.2 AA (2.5.8) requires 24 px. Counts of controls under 24 px are in `data/*.json` (`viewports.<w>.small24`)._
