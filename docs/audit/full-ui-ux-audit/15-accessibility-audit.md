# 15 — Accessibility audit (target WCAG 2.2 AA)

Method: axe-core 4.x (wcag2a/aa, 2.1, 2.2 AA + best-practice) on every authenticated load at 1440 px and WCAG A/AA at 390 px; keyboard traversal of the first 14 tab stops per page; manual keyboard-only run of the exam player; achromatopsia emulation; computed contrast ratios for every colour token. **No screen reader (NVDA/JAWS/VoiceOver) was run and no human assistive-technology test was done — nothing here claims WCAG compliance.**

## 1. AUTOMATED FAILURES (axe, 197 loads)

| Rule | Impact | Loads affected | Nodes | What it is |
|---|---|---|---|---|
| `color-contrast` | serious | 154 | 570 | Elements must meet minimum color contrast ratio thresholds |
| `label-content-name-mismatch` | serious | 105 | 126 | Elements must have their visible text as part of their accessible name |
| `empty-table-header` | minor | 37 | 43 | Table header text should not be empty |
| `page-has-heading-one` | moderate | 30 | 43 | Page should contain a level-one heading |
| `region` | moderate | 14 | 32 | All page content should be contained by landmarks |
| `landmark-one-main` | moderate | 7 | 14 | Document should have one main landmark |
| `aria-allowed-attr` | critical | 2 | 6 | Elements must only use supported ARIA attributes |
| `scrollable-region-focusable` | serious | 2 | 2 | Scrollable region must have keyboard access |

Mobile (390 px, A/AA only): color-contrast on 74 loads, scrollable-region-focusable on 2, aria-allowed-attr on 2. Public pages: color-contrast (login ×2, forgot ×1, 404 ×1), region on all four.

## 2. MANUALLY VERIFIED FAILURES

| Check | Finding | WCAG | Issue |
|---|---|---|---|
| Skip link | none on any page; first Tab stop is the first sidebar link on 176 pages | 2.4.1 | UI-009 |
| Page titles | identical on all 197 loads | 2.4.2 | UI-010 |
| Dialog focus | focus stays behind the dialog; no trap | 2.4.3 | UI-013 |
| Palette semantics/keyboard | `role=listitem` on buttons; 86 Tab presses to Q87 | 4.1.2, 2.1.1 | UI-012 |
| Colour as sole cue | greyscale emulation: Unanswered ≈ Not visited, Skipped = pale fill | 1.4.1 | UI-014 |
| Duplicate accessible names | 189 identical "Report" buttons on one page | 2.4.6 / 2.5.3 | UI-029 |
| Muted text contrast | #8A7A77 = 4.09:1 on white, 3.83:1 on ivory | 1.4.3 | UI-011 |
| Disabled primary button | white on 50 % crimson = 2.28:1 (exempt as disabled, but it is the default state of Sign in) | 1.4.3 (exempt) | note |

## 3. POTENTIAL ISSUES (computed or source-read, not user-tested)

- Control boundaries (#E9DDDA on white = 1.33:1) — WCAG 1.4.11 asks 3:1 (UI-047).
- Fixed 14 px base font, no rem — browser text-size preference ignored (1.4.4) (UI-046).
- Sticky header 126–168 px on phone/tablet can obscure focused controls (2.4.11 Focus Not Obscured, new in 2.2) (UI-036).
- Tables: no captions, 95 of 101 without header scope, empty header cells on 37 pages, scroll container not focusable on 2 (1.3.1) (UI-043).
- Status messages: save indicator uses `role=status aria-live=polite` (good); toasts container live-region attributes not verified.
- `aria-pressed` on non-interactive chips (axe critical) (UI-037).

## 4. What passed

- All 3,399 controls have an accessible name; none is icon-only; every tab stop tested shows a visible focus indicator (outline or ring).
- Exam options are a `radiogroup` with 5 `radio` buttons; keyboard shortcuts A–E / ← → work; Escape closes dialogs; Review → Submit is fully operable by keyboard (Enter/Space).
- Timer is `role=timer` and not announced continuously; no flashing or animation except a skeleton shimmer with `prefers-reduced-motion` support; low-time state is a colour change at < 5 minutes (no blink).
- `lang="en"` on every page; every form control has a programmatic label (0 placeholder-only inputs).
- Offline/failed-save states are text, not colour only ("Not saved — offline, will retry").

## 5. NOT TESTED

Screen-reader announcements (live regions, dialogs, table navigation), voice control, Windows High Contrast, 400 % zoom/320 px reflow, touch exploration, Urdu/RTL content, caption/alt text for question images (not implemented), form error announcements (no inline errors exist to announce — UI-026), PDF/print accessibility of the certificate.

## 6. Critical student interactions without a mouse

| Task | Possible? | How |
|---|---|---|
| Select an answer | Yes | Tab to option + Space/Enter, or press A–E |
| Navigate questions | Yes (slow for distant ones) | ← →; Tab through palette (86 presses to Q87) |
| Flag a question | Yes | Tab to "Mark for review" |
| Skip | Yes | Tab to "Skip question" |
| Review | Yes | Enter on "Review & submit" |
| Submit | Yes | Enter on "Submit examination…", Space on checkbox, Enter on "Confirm and submit" (focus not trapped in the dialog) |
