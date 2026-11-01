# 14 — Mobile, tablet and responsive audit

Viewports measured on every authenticated load (197) and every public page (4): 360, 390, 428, 768, 1024, 1280, 1440, 1600 px. Screenshots at 1440, 768 and 390 for every load; DOM measurement (scroll width, clipped elements, tap targets, sidebar/menu state) at all eight.

## 1. Horizontal overflow (page scrolls sideways)

| Viewport | Loads with overflow | Detail |
|---|---|---|
| 360 | 11 | authenticated: /does-not-exist (392px); public: /login, /forgot, /verify, /this-page-does-not-exist |
| 390 | 11 | authenticated: /does-not-exist (392px); public: /login, /forgot, /verify, /this-page-does-not-exist |
| 428 | 0 | none |
| 768 | 0 | none |
| 1024 | 0 | none |
| 1280 | 0 | none |
| 1440 | 0 | none |
| 1600 | 0 | none |

Result: **no authenticated page overflows at any viewport** (the responsive shell removed the earlier problems). The only overflow is ≈ 2 px on the four public pages at 360/390 px and the 404 page (UI-039).

## 2. Navigation model by width

| Viewport | Sidebar | Menu button | Evidence |
|---|---|---|---|
| 360 | permanent on 0 of 197 loads | present on 176 of 197 | drawer |
| 390 | permanent on 0 of 197 loads | present on 176 of 197 | drawer |
| 428 | permanent on 0 of 197 loads | present on 176 of 197 | drawer |
| 768 | permanent on 0 of 197 loads | present on 176 of 197 | drawer |
| 1024 | permanent on 176 of 197 loads | present on 0 of 197 | permanent sidebar |
| 1280 | permanent on 176 of 197 loads | present on 0 of 197 | permanent sidebar |
| 1440 | permanent on 176 of 197 loads | present on 0 of 197 | permanent sidebar |
| 1600 | permanent on 176 of 197 loads | present on 0 of 197 | permanent sidebar |

The breakpoint is 1024 px: ≥ 1024 permanent sidebar, below it a drawer opened from "☰ Menu" (verified earlier in 8 Playwright tests and re-observed in this crawl). A control-centre heading now starts within 220 px of the top at 390 and 768 px (before the shell fix it began ≈ 420 px down).

## 3. Live examination player (100 questions unless stated)

| Viewport | Header height | Palette buttons fully visible on first screen | Interactions to reach Q87 | Notes |
|---|---|---|---|---|
| 1536×864 | 76 px | 90 / 100 | 1 click | |
| 1440×900 | 76 px | 96 / 100 | 1 click | only the last 4 below the fold |
| 1366×768 | 76 px | 72 / 100 | 1 click + page scroll | palette not sticky (UI-005) |
| 1280×720 | 76 px | 66 / 100 | 1 click + page scroll | |
| 1024×700 | 76 px | 66 / 100 | 1 click + page scroll | |
| 768×1024 (tablet) | 126 px (12 %) | sheet: 78 visible | toggle + 1 swipe + tap = 3 | sheet 840 px of 1,149 px content |
| 390×844 (phone) | 168 px (20 %) | sheet: 54 visible | toggle + 1 swipe + tap = 3 | |
| 360×640 (small phone) | 168 px (26 %) | sheet: 30 visible | toggle + 2 swipes + tap = 4 | |
| 640×360 (= 200 % zoom of 1280×720) | ≈ 36 % of height | 0 (sheet only) | toggle + many swipes | Save/Skip/Next below first screen |
| Long vignette @ 390×844 | 168 px | — | — | option A below the first screen; page height 2,278 px; timer stays visible |

Other measured behaviours (all viewports): timer and **Review & submit** remain visible after scrolling to the bottom (sticky header — good); offline banner and "Not saved — offline, will retry" appear and recover ≤ 6 s after reconnect (good); no horizontal overflow at 360–1600; reload returns to the instructions page (UI-040).

## 4. Tap targets

Across all loads at 390 px, 1,967 interactive controls are smaller than 44 × 44 px (mostly `btn-sm` row buttons, breadcrumb-adjacent buttons and table links); at ≤ 1023 px base buttons were raised to 40 px by the shell fix. Below 24 px (WCAG 2.5.8 fail) counts are in the raw data.

## 5. Tables on phones

Tables built with the shared Table component become labelled cards below 640 px (verified at 390 px on students, monitor, users, audit). The audit table at 768 px scrolls horizontally inside its card. Evidence: `evidence/mobile/m07-monitor-390.jpg`, `m08-students-390-cards.jpg`.

## 6. Not tested

Real devices (iOS Safari, Android Chrome), on-screen keyboard covering inputs, landscape orientation, pinch zoom, 400 % zoom (WCAG 1.4.10 reflow at 320 px) beyond the 200 % emulation above, and OS text-size scaling (not honoured: fixed 14 px base, UI-046).
