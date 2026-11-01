# Design system

Source references: `design/reference/IMG_0586.png` (university logo) and `design/reference/Examination Portal — Print Deck.pdf` (31 pages: auth, student, lecturer, examiner, admin flows).
Implementation: `apps/web/src/app/globals.css` (tokens + components), `apps/web/src/ui.tsx` (primitives).

## Palette
| Token | Hex | Use |
| --- | --- | --- |
| `--maroon` | `#781F27` | Table header text, links, active accents, certificate border |
| `--burgundy` | `#451619` | Navigation sidebar, auth art panel |
| `--crimson` | `#BC3040` | Primary action, focus ring, current-question outline, error text |
| `--ivory` | `#FAF7F4` | Page background |
| `--rose` | `#E9DDDA` | Borders and dividers |
| `--green` | `#155B3C` | Positive / secondary action ("Start", "Save", answered), question header |
Supporting tints (status badges only): amber `#FBF1D6/#8A5A00`, green `#E3F1E9`, red `#F8E3E1`, blue `#E4EDF5/#1F4E79`.

## Deliberate departures from the print deck
- **No yellow table headers** — replaced with a pale warm tint and maroon small-caps text (restrained, higher contrast).
- **No gradients, glass, or heavy shadows**; flat surfaces with 1 px rose borders. The only shadow is the notification popover.
- **Logo**: the real university logo is placed on an ivory plate (sidebar, exam bar, certificate) so its maroon artwork keeps full contrast on the burgundy sidebar.
- The deck's "M" placeholder mark and four-role sign-in picker are not used: sign-in is one form; the role is derived server-side from the account.

## Typography
Inter (falls back to the system UI stack — no network font fetch), 14 px base; `JetBrains Mono`/system mono with tabular numerals for codes, counters, clocks and numeric table columns.

## Components
Sidebar nav (3 px crimson left rule on active) · topbar with breadcrumb + notifications · stat tiles · compact tables (8 px cell padding, numeric columns right-aligned mono) ·
status badges (dot + label — colour is never the only signal) · modal/confirm · toast (`role=status`) · question palette · save-state indicator · OTP input · password-strength meter.

## Exam screen
Burgundy-free, ivory working surface; green question header (`QUESTION 03 / 12 · CLINICAL`), clinical vignette in a maroon-ruled block, radio-card options (A–E),
footer controls: Previous · Skip question · Mark/Unmark review · Clear response · *Saved/Not saved* · Save & next · Next.
Palette: Answered (green fill) · Skipped (amber) · Unanswered (maroon outline) · Not visited (neutral) · Marked (crimson corner flag) · Current (crimson outline). Filters + progress bar + counters.

## Accessibility
Skip-free semantic landmarks (`nav`, `main`, `aside`), `role=radiogroup/radio` for options with `aria-checked`, `role=timer` for the clock, `aria-live` regions for save state and connection banners, labelled form controls,
`:focus-visible` rings on every interactive element, keyboard shortcuts (A–E, ←/→), `prefers-reduced-motion` respected, responsive down to 360 px (palette moves below the question).
Not yet audited: full WCAG 2.2 AA review with assistive technology (see implementation-status).
