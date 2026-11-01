# 08 — UI/UX Assessment

**Visual verification scope (honest):** in the previous session I ran the app and opened screenshots of **three** screens only: login, exam player, staff students table. Student dashboard and schedule screenshots were captured but **not viewed**. All other screens are assessed from source/CSS only (code-level findings, not visual ones). No screenshots were taken in this audit (servers not started, to avoid re-seeding).

## Reference assets
`design/reference/IMG_0586.png` (real logo; used unmodified at `apps/web/public/logo.png`) and the print deck PDF (self-described "concept prototype"). Deliberate departures from the deck: no yellow table headers, no gradients, no role-picker on sign-in.

## Findings
| Area | Finding | Basis |
|---|---|---|
| Palette | Tokens in `globals.css` match the six specified hex values; burgundy sidebar, ivory canvas, maroon accents, green for answered/success | source + 3 viewed screens |
| Logo | Real logo on login (ivory plate) and exam header | viewed |
| Exam player | Palette states (answered / skipped / marked / current), filters, progress counters, "✓ Saved" only after ack, review + receipt screens present | viewed (player) + source |
| Tables | Compact, maroon-tinted header, campus-scoped | viewed (students) |
| Typography | System font stack only — safe, but no deliberate type scale review against the deck | source |
| Responsive | CSS has breakpoints; **not browser-tested at mobile widths** | NOT_VERIFIED |
| Accessibility | Semantic buttons/labels used; no automated axe run, no keyboard-only exam walkthrough, no screen-reader pass, contrast not measured | NOT_VERIFIED |
| Loading / error states | Shared components exist (`ui.tsx`); consistency across all 19 pages not reviewed | PARTIAL |
| Missing screens vs deck | settings/feature toggles, ⌘K search, course materials, subjective grading, tab-switch/focus-loss columns in monitor, venue capacity | MISSING |
| Brand/anti-template | No gradients/glass/neon; restrained shadows (source) | source |

## Actions
1. Run axe + keyboard-only Playwright pass on login, exam player, and one staff table (P1).
2. Mobile viewport screenshots for the exam player (students may sit on tablets) (P1).
3. View the two unviewed screenshots, then screenshot every route under each of 7 roles for a design review (P3).
