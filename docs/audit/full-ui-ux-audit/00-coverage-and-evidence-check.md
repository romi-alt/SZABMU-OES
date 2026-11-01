# 00 — Coverage and evidence self-check

This is the final challenge of the audit's own findings (brief, last section). Nothing below is claimed beyond what the matrices justify.

## 1. Route coverage vs the frontend route inventory
- Frontend routes in source (`apps/web/src/app/**/page.tsx`): 26 page files (incl. the root redirect) → 21 authenticated screen patterns + 4 public/auth pages (login, forgot, verify, mfa) + the branded 404.
- **Every pattern was opened in a real browser** as every one of the 7 implemented roles: **197 authenticated loads** (28 route variants for each of the 6 staff roles + 29 for the student, who additionally opens a real certificate id) at 1440 px with 768/390 screenshots and DOM/axe measurement at 8 viewports, plus **4 public pages**. 0 loads failed to render.
- **Not opened in a browser (and why):** `/mfa` for real (redirects because `MFA_ENFORCE=false`; enrolment prompt seen in an earlier session only); the candidate **reset-password** step (flow reached step 2 "Verify it's you" only); **Institution Administrator** (role does not exist); Settings, Course materials, Manual grading, Performance reports, Student detail (pages do not exist — recorded as MISSING REQUIRED UI, not as broken); `/certificate/:id` for a *failed* result (no failing candidate with a certificate path — certificates are issued for passes only).

## 2. Interactive controls
- Inventoried: **3,399** controls on 197 loads (labels, roles, sizes, names). Exercised (clicked/typed): ~60 distinct controls — listed in doc 12. **Not exercised:** all data-changing row actions except Deactivate/Activate institution (Deactivate/Reset password on users, Revoke, Withdraw/Admit/Set extra time, + Time/End, Condone, Import/Add student, Export CSV, Verify chain integrity, incident status/notes, bulk checkboxes, Mark all read, print, password change). Reason: unnecessary to prove the findings; their labels/positions were inspected from the DOM.
- No finding is based on a control that was not at least rendered and measured.

## 3. Roles
All 7 implemented roles were fully crawled and key journeys were driven for Student, Lecturer, Examiner, CCE, Campus Admin (A), Invigilator and Super Admin. **Campus B administrator/invigilator** were not crawled separately (same role, different data). Multi-campus users and a user with two roles were not tested.

## 4. Viewport matrix
8 viewports (360, 390, 428, 768, 1024, 1280, 1440, 1600) measured on all 201 loads; screenshots at 1440/768/390. Player additionally at 1536×864, 1366×768, 1280×720, 1024×700, 640×360. **Not done:** real devices, landscape, 400 % zoom, browser text-only zoom.

## 5. P0 / P1 verification
Counts: P0 0 · P1 8 · P2 31 · P3 13. Every P1 has: numbered reproduction steps, a browser observation or measurement, at least one committed screenshot, a source reference and acceptance criteria (UI-001 … UI-008). P1s UI-003/004/005 were measured in two independent runs (first player run + extra run with intercepted requests). UI-002 was reproduced twice (UI click and direct API call) and its root cause located in source.

## 6. Screenshot reference check
173 distinct `evidence/…` references across all documents; **0 broken** . 84 images are committed (5.8 MB); 0 committed images are not referenced by any document. The full crawl screenshots (197 × 3 sizes) were not committed (size); they and the raw data can be regenerated with `tools/`.

## 7. Claims challenged and corrected during self-review
| Original suspicion | Result |
|---|---|
| "Instructions hard-code 'no negative marking'" | **Refuted** by source (text is conditional on the exam's setting) — removed |
| "Results and Performance confusingly overlap" | Not supported by observation — downgraded to a low-priority *recommendation* (doc 03 §4); only the Absent/No-results inconsistency kept (UI-042) |
| "Save indicator shows ✓ Saved immediately after clicking an option at 1440×900" | Single-run timing artefact (other viewports showed "Saving…") — **not claimed** |
| "Audit table 'When' wraps to four lines" | Seen once in the crawl screenshot, not reproduced in a later measurement — kept as Medium confidence inside UI-038 |
| "Six dead notification links" (previous audit) | Not reproduced; one link to a candidate-only page remains (UI-031) |
| "Mobile sidebar stacking / palette below fold" (previous audit) | Resolved / partly resolved (table in doc 21) |
| First-pass jump-to-Q87 scroll counts on phones | Measurement artefact (wheel events over the page, not the sheet) — replaced by geometry-based numbers |
| Initial "no pager" reading on Students | Wrong selector; pager exists ("80 records · Page 1 of 4") |
| Examiner "Register institution does nothing" | Wrong: it returns a 403 toast and keeps the modal open (UI-019) |
Duplicate issues merged: enrolment crash seen for students/invigilators merged into UI-001/UI-018.

## 8. Recommendations that are design opinion, not defects
Merging Results + Performance; dropping the invigilator dashboard; adding global search; sticky bottom action bar on phones; renaming "Live monitor"; merging Skipped/Unanswered states (product decision); Save-and-submit in the question editor. They are labelled as recommendations wherever they appear.

## 9. Unresolved evidence gaps
Screen-reader behaviour; real devices; 200-question palette; long-running exam sessions (> 1 h) and token/session expiry mid-exam; authorised suspension re-capture (HISTORICAL); failing-candidate result and certificate view; incident resolve/notes; Settings/permissions screens (absent); rendering with Urdu content.

## 10. Re-verification of the exam player (requested)
Answer-saving indicator, palette, Skip, Mark for review and final Submit were re-checked in a second run: indicator timings 56–100 ms to "✓ Saved" at all viewports; palette counts identical (66/72/90/96 fully visible at the four laptop sizes); Skip→"skipped", Next→"unanswered" confirmed via aria-labels; Mark toggles `aria-pressed`; submit dialog text and disabled-until-ticked state identical. No contradiction with the first run was found.
