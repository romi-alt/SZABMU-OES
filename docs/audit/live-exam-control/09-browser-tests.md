# 09 — Browser tests (Playwright / Chromium, real stack on a disposable PostgreSQL + Redis)

`tests/e2e/exam-control.spec.ts` (4 specs) drives a **real, centrally controlled examination**. The exam is built through the real API (examiner builds the paper, the CCE approves it, the examiner schedules it, the CCE approves the suspension policy); the controller uses the control centre in one browser, candidates sit in others; every number shown comes from the backend.

| Spec | What it proves |
|---|---|
| setup | MANUAL-control exam built through the real four-eyes workflow |
| **control cycle** | Header shows title, code, subject, program, window, duration, timing/control mode, paper fingerprint, official start; stats tiles; buttons are driven by the state machine (Suspend/Resume/Initiate-scoring disabled until valid). A candidate cannot begin before admission. **Open admission** → status "Admission open" → candidate enters, saves "✓ Saved", the controller's *Admitted (entered)* tile shows 1 (pushed). **Start** → Live. **Suspend** (reason + confirmation required; Go disabled until both) → status Suspended, candidate's screen shows the suspended banner within seconds, inputs inert, *Review & submit* disabled. **Resume** → banner clears, "resumed" message, saving works again. **Extend** (Go disabled until *Preview* shows the affected count) → candidate sees "extended by 10 minutes"; the extension history lists it. **Force-close** (reason) → candidate settles into a receipt `RC-…`; status Closed; **Initiate scoring** → Result pending; health card shows the lifecycle worker |
| campus + candidate boundaries | Campus admin: monitor shows only DMC-A rows; the command centre shows the access-denied panel; suspend/start/close → 403. A candidate opening the command centre gets access denied |
| synchronized lobby | Admitted candidate sees the lobby (no timer, no paper); when the controller starts the exam the page opens it on the push |

Existing specs still pass (the earlier exam player, MFA, CSP, notification, error-state, all-questions and staff workflows). One regression found and fixed during this work: the synchronized drill left an admission-open exam, giving other specs' candidates a second "Start" link; the spec now closes every exam it makes (in `afterAll`, even on failure).

Final results (this phase, disposable stack): **33 of 33 Playwright specs pass** after the control specs were added (29 existing + 4 new). The exact final regression commands, counts and exit codes are recorded in `docs/implementation-status.md` (checkpoint 12).

## Not covered

Accessibility of the control centre (no axe run), mobile layout of the control centre (desktop-first dense dashboard; the campus monitor reuses the existing responsive shell), Firefox/WebKit, SSE through a buffering proxy.
