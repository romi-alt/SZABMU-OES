# 16 — Visual design system

## Tokens vs the specified palette (measured from `globals.css`)
University Maroon `#781F27`, Deep Burgundy `#451619`, Action Crimson `#BC3040`, Warm Ivory `#FAF7F4`, Border Rose `#E9DDDA`, Success Green `#155B3C` are all defined as CSS variables and used as intended (sidebar burgundy, ivory page, crimson primary buttons, green success buttons, maroon table headers). The reference deck (31 pages) uses a similar maroon palette with a **gold/yellow table-header band** that the implementation does not copy — the implementation's pale rose headers are calmer and more legible, so this deviation is a good one.

## Contrast table (computed)
| Pair | Ratio | Result |
|---|---|---|
| ink #241716 on ivory | 16.3 | pass |
| ink-2 #5E4E4B on white / ivory | 7.9 / 7.4 | pass |
| **ink-3 #8A7A77 on white / ivory** | **4.09 / 3.83** | **FAIL** (UI-011) |
| maroon on white | 10.4 | pass |
| crimson text on white; white on crimson | 5.78 | pass |
| white on green | 8.1 | pass |
| sidebar #EBD9D6 on burgundy | 11.2 | pass |
| nav label #B58F8B on burgundy | 5.3 | pass |
| status chips (green/amber/blue/red on tinted bg) | 4.7–7.3 | pass |
| **disabled primary (white on pale crimson)** | 2.28 | exempt (disabled) but it is the default state of the login button |
| **input/option borders #E9DDDA on white** | **1.33** | below 3:1 for UI component boundaries (UI-047) |

## Drift and consistency
- Border radii: 2, 3, 4, 5, 6, 7, 8, 10, 12, 14 px and 50 % (11 values) — a 4/8 scale would do.
- Font sizes: 10, 11, 11.5, 12, 13, 13.5, 14, 15, 17, 20, 22, 28, 30 px (13 sizes); base `14px` fixed (no rem) so browser text-size settings are ignored.
- 18 hard-coded hex colours in CSS outside `:root`, 14 in TSX, **101 inline `style={{…}}` blocks** — styling logic is scattered in components (UI-046).
- Shadows: 5 uses, restrained. Animations: one skeleton shimmer, reduced-motion respected. No gradients, no decorative hero blocks — the interface is restrained and institutional (a strength; nothing generic-"AI dashboard").
- Button variants: default, primary (crimson), green, danger (crimson text), sm — **crimson means both "main action" and "danger"** (UI-046); e.g. "Control centre" (solid crimson) next to "Suspend…" (crimson text).
- Page widths: `.content { max-width: 1280px }` on all authenticated pages — consistent; the player uses its own 1280 px grid.
- Cards: consistent border (rose) and radius 8 px; stat tiles have 4 sizes of label/value; mono numerals for counts (good for scanning).
- Icons: none used (text only); no icon-only controls.
- Logo placement: sidebar plate, login art panel, instructions page and player header now use one `BrandLogo` component (fixed in this session, commit `7f4c6dd`); certificate uses it without a plate.
- Empty states: plain centred grey sentences ("No incidents."); no illustration, no next action.
- Charts: one bar chart (Performance) readable but trivial with one subject.

## What to preserve
Colour restraint, mono numerals, status chips, the sticky exam header, labelled form controls, read-only-with-reason pattern on the control centre.
