# 06 — Student live examination player (highest-risk UI)

**Method:** real exams in a disposable stack — a 100-question paper, a 10-question paper with 5 long clinical vignettes and 5 long-option items, viewports 1536×864, 1440×900, 1366×768, 1280×720, 1024×700, 768×1024, 390×844, 360×640 and 640×360 (= 200 % zoom), achromatopsia emulation, offline mode, intercepted save requests (HTTP 500, 409, hung), keyboard-only operation, review/confirm flow. Scripts: `tools/player-*.mjs`; data: `data/player-*.json`. The player's behaviour was measured twice (first run + extra run); results were consistent. Authorised suspension/resume/extension were verified in the previous live-control drill (screens captured then) and **not repeated** in this audit.

## 1. Verdict
The core exam loop is **sound and, in several respects, well designed**: autosave with server-confirmed "✓ Saved" (≈ 56–100 ms), a sticky header that keeps the timer and "Review & submit" visible at all times, clear offline banner and recovery within 6 s, two-step submission with a checkbox, a review screen that lists answered/skipped/unanswered/not-visited/marked, and keyboard shortcuts. It is **not yet safe for a large, long, mixed-network examination** because of four defects: a hung save never escalates (UI-003), review/submit locks for ~20 s when a save fails and gives no way forward (UI-004), the palette is not sticky and is clipped on common laptops (UI-005), and states depend on colour (UI-014). No P0 was found: in every failure mode tested the UI either saved, said it had not saved, or (hang) stayed honestly on "Saving…".

## 2. Control-by-control

| Control | Behaviour observed | Verdict |
|---|---|---|
| Question card | green header "QUESTION 01 / 100 · CLINICAL · 2 MARKS", vignette block, stem, options A–E as large cards | clear; marks and number visible |
| Option selection | click/tap or press A–E; selected card gets green border + filled radio + `aria-checked` | selected state obvious |
| Saved indicator | beside Save & next: "Saving…" → "✓ Saved" (green) / "Not yet saved — retrying" / "Not saved — offline, will retry" | trustworthy for offline and 500; **hang stays "Saving…"** (UI-003); 12 px text is easy to miss on 500/409 (no banner) |
| Previous / Next | Next with unanswered current → question recorded "unanswered" | fine |
| Skip question | records "skipped", moves on | duplicates Next semantically (UI-016) |
| Mark for review | toggles (label becomes "Unmark review", `aria-pressed`) | clear |
| Clear response | removes saved answer instantly; no undo | UI-015 |
| Save & next → | waits for pending saves ≤ 8 s then moves | label implies manual save (UI-016) |
| Timer | boxed "REMAINING 45:00" in the sticky header, `role=timer`, turns crimson < 5 min, no blinking | not stressful; always visible |
| Palette | 6 columns of 44×34 px buttons, progress bar, filter chips (All/Answered/Skipped/Unanswered/Not visited/Marked), legend | desktop good for ≤ 66; see UI-005/012/014/017 |
| Review & submit | header button; review screen with counts, jump-back buttons, "Submit examination…" | good; blocked when saves fail (UI-004) |
| Submit dialog | "You answered 2 of 100 questions. 98 will be marked as unanswered." + checkbox "I have reviewed… final" + Cancel / Confirm and submit (disabled until ticked) | **well protected**; focus not moved into it (UI-013) |
| Receipt | code RC-…, clear end state (observed in earlier drill) | good |

## 3. The six states
ANSWERED (solid green), SKIPPED (pale amber fill), NOT VISITED (white, rose border), UNANSWERED (maroon outline), MARKED (red corner triangle), CURRENT (crimson ring). All six exist and are distinguishable **in colour**; palette buttons also carry text in `aria-label` ("Question 3, skipped"). In greyscale Unanswered ≈ Not visited and Skipped ≈ a light fill (UI-014). Whether "Skipped" and "Unanswered" should be separate states is a product question — students gain nothing from the difference (UI-016).

## 4. Questions from the brief
- *Skip mistaken for Next?* They sit side by side and look identical; effect differs only in recorded state.
- *Does "Save & next" imply no autosave?* Yes, it suggests manual saving, although the instructions say answers autosave.
- *Clear Response accidental loss?* Yes, no undo (UI-015).
- *Can "Saving…" stay stuck?* **Yes (hang), measured 30 s (UI-003).**
- *Are failed saves visible?* Yes in the indicator ("Not yet saved — retrying", persistent), but only as 12-px text; Review reveals the count after ~20 s (UI-004).
- *Timer stress/flashing?* No flashing; colour change at 5 min only.
- *Timer visible while scrolling?* **Yes** — header is sticky (verified after scroll to bottom at every viewport).
- *Palette visible without excessive scrolling?* 90–96 of 100 at ≥ 864 px height; 66–72 at 720–768 px; sheet on phones (UI-005, UI-017).
- *Jumping predictable?* Yes: click → question changes, palette highlights it; 1 click on desktop; 3–4 interactions on phones.
- *100–200 numbers?* **100 tested; 200 not tested** (fixture limit) — extrapolating, 200 buttons make the column ≈ 1,350 px tall, so the laptop clipping would roughly double.
- *Current question identified?* Yes (crimson ring + number in header).
- *Answers survive navigation/refresh?* Navigation yes. Refresh/resume: covered by the existing Playwright spec (`exam-all-questions`, which reloads) — passed in today's 41/41 run; not separately re-measured here.
- *Flagged answered questions represented?* Yes — green fill plus corner mark, counted in "Marked".
- *Final submit close to routine navigation?* No: it is in the header, away from the bottom action row.
- *Confirmation after every simple action?* No — good: none for answer/skip/mark/clear (Clear should get an undo, not a dialog).
- *Pending saves explained before submission?* Yes ("1 answer(s) could not be stored yet… Do not close this window") but it blocks instead of guiding (UI-004).

## 5. Behaviour under conditions

| Condition | Result |
|---|---|
| Short MCQ | fits first screen on all sizes ≥ 360×640 except the action row at 360×640 |
| Long clinical vignette | desktop fine; at 390×844 option A starts below the first screen, page 2,278 px (UI-041) |
| Long answer options (≈ 520 chars × 5) | wraps without clipping; 439 px per option at 390 px; page 2,843 px (UI-052) |
| 100 questions | see palette findings |
| Narrow desktop 1024×700 | palette 66/100 visible (UI-005) |
| Tablet 768×1024 | palette in sheet; header 126 px |
| Phone 390×844 / 360×640 | header 168 px (20 % / 26 %); 3–4 interactions to jump (UI-017/036) |
| 200 % zoom (640×360) | timer and Review visible; Save/Skip/Next below first screen; palette only via sheet |
| Temporary network interruption | banner "Connection lost. Keep working — your answers are held on this device…" + "N not yet saved"; recovers ≤ 6 s; Review & submit stays enabled |
| Hung save | "Saving…" indefinitely (UI-003) |
| Server 500 on save | "Not yet saved — retrying" persistent; no banner; Review blocks ~20 s (UI-004) |
| HTTP 409 STATE_CHANGED | same as 500 (retries; no explanation) — acceptable for a transient state change, but a suspension is then only visible through the heartbeat banner |
| Authorised suspension | red banner + frozen clock + disabled controls (previous drill) |

## 6. Keyboard-only (measured)
First 22 tab stops: Review & submit → layout toggles → options A–E → Skip → Mark → Clear → Save & next → Next → filter chips → palette (Q1…). Shortcuts `c` selects option C, ← → move. Reaching Q87 by Tab takes 86 presses (UI-012). Submit by keyboard works end-to-end; dialog focus not trapped (UI-013); Escape closes the dialog.

## 7. Evidence
`s04…s15`, `m02–m05`, `m11–m13` in `evidence/`.
