> Evidence file for `docs/audits/SZABMU-OES-INFRASTRUCTURE-AND-AI-READINESS-AUDIT.md` (2026-11-07). Produced by static, read-only code review; nothing was executed. Each finding is tagged VERIFIED (code read at the cited line) or ASSUMPTION. Findings in the main report marked "re-checked" were additionally confirmed by the lead auditor.

# Frontend architecture audit — SZABMU OES (apps/web, packages/shared)

Read-only review. Paths relative to /home/user/SZABMU-OES unless stated. Tags: VERIFIED = read in code; ASSUMPTION = inferred, not proven.

## 1. Stack and architecture facts (VERIFIED)
- Next 16.4.3, React 19.3.1, TypeScript 5.9.3 installed (node_modules package.json); `apps/web/package.json:11-14` declares `next ^16.4.3`, `react ^19.3.1`. App Router, `src/proxy.ts` (Next 16 rename of middleware). Zero third-party UI/data libs: only next/react/react-dom/@oes/shared as dependencies.
- 39 `page.tsx` files; 38 begin with `'use client'`; only `src/app/page.tsx:1-2` (a redirect) is a server component. Root layout forces per-request dynamic rendering (`app/layout.tsx:13`, `connection()`) because of the CSP nonce, so nothing is statically prerendered.
- Data layer is hand-written: `api.ts:10` fetch wrapper (same-origin `/api`, cookie credentials, no token handling), `useGet` hook `api.ts:40-55`, SSE helper `openStream` `api.ts:72`. No cache, dedupe, background revalidation, GET retry or optimistic updates (grep `optimistic` = 0 hits; `setData` used for local patching only).
- Auth state: httpOnly-cookie model from the client's view (no token read/written in JS; `api.ts:13` `credentials:'same-origin'`; nothing in localStorage). Flag attributes of the cookie are set by the API (not reviewed here). `SessionProvider` (`session.tsx:18-42`) loads `/auth/me`, redirects to `/login` if absent, forces `/complete-profile` and `/mfa`.
- Portals: one build, two processes or one host-routed process. `proxy.ts:16-22` resolves portal from `PORTAL` env (or trusted `X-OES-Portal` only when `PORTAL_FROM_HEADER==='true'`); pages whose first path segment is not in the portal's list are rewritten to `/__not-served-on-this-portal` (404). Lists in `packages/shared/src/portal.ts:23-27`: shared = '', login, forgot, verify, mfa, dashboard, profile, help; student = schedule, results, performance, exam, certificate, register, complete-profile; staff = 19 segments. Cross-portal links via `portal-urls.ts:3-8` (build-time `NEXT_PUBLIC_*`, defaults to oes.szabmu.site / dashboard.szabmu.site). I cross-checked every route directory under `src/app` against these lists: every page belongs to at least one portal; no orphan pages. `/classes`, `/pools`, `/submissions`, `/my-students`, `/my-courses` are staff-only (TEACHER/LECTURER), `/register/teacher` student-host only.

## 2. Findings

### FE-01 MEDIUM — Candidate integrity signals are far narrower than the server protocol and the benchmark doc claim
- Where: `apps/web/src/exam-engine.ts:55` (only `TAB_HIDDEN`), `:79` (`ONLINE`/`OFFLINE`); server accepts `TAB_HIDDEN, TAB_VISIBLE, FULLSCREEN_EXIT, OFFLINE, ONLINE, PASTE_BLOCKED` (`apps/api/src/modules/delivery/delivery.controller.ts:24`); `docs/audits/GLOBAL_EXAM_PLATFORM_BENCHMARK.md:34` says "tab hidden, fullscreen exit".
- Evidence: `grep FULLSCREEN_EXIT|PASTE_BLOCKED|TAB_VISIBLE apps/web/src` returns nothing. No fullscreen request, no paste/copy/contextmenu handlers, no window `blur`, no `beforeunload` in `exam/[examId]/page.tsx`. Events are throttled to one per kind per 5 s (`exam-engine.ts:232`).
- Impact: documented "fullscreen exit" evidence is never produced; `integrityFlags` can only count tab-hide. Proctoring-style claims are overstated; server code paths for 3 event kinds are dead.
- Recommendation: either emit the remaining events (fullscreen API, paste block, visible) or correct docs and drop unused enum values. Add `beforeunload` warning during an attempt.
- Tag: VERIFIED.

### FE-02 MEDIUM — Portal allow-list fails open when env is unset
- Where: `apps/web/src/proxy.ts:16-17`.
- Evidence: `portal = portalOf(process.env.PORTAL) ?? (PORTAL_FROM_HEADER==='true' ? header : null)`; when null the `if (portal && ...)` guard (`:17`) is skipped and all pages serve (both portals' pages, e.g. admin pages on the student host). `PortalProvider` likewise receives null.
- Impact: a missing `PORTAL` env var in one of the two deployed processes silently removes the UI separation. Docs say the API enforces the boundary independently (`portal.ts:10-11`); I did not test that enforcement here, so the UI exposure is cosmetic only if the API check holds.
- Recommendation: in production require one of the modes (fail closed / refuse to start if neither set); add a startup/health assertion and a test for the null case.
- Tag: VERIFIED (code); API enforcement ASSUMPTION (other reviewer's area).

### FE-03 MEDIUM — Oversized, extremely dense page files; copy-paste across pages
- Where / evidence (lines; bytes; longest line): `exam/[examId]/page.tsx` 369 lines, 38.6 KB, 608-char line; `(app)/pools/page.tsx` 269, 33.8 KB, 486; `(app)/exams/[id]/page.tsx` 200 lines, 27.0 KB, 699-char line; `(app)/institutions/page.tsx` 179, 25.9 KB, 542; `exams/[id]/control/page.tsx` 239; `register/teacher/page.tsx` 190. Across `.tsx`, 221 lines exceed 300 chars. Line counts understate size (multi-statement lines).
- Duplication: authenticated image viewer implemented twice (`pools/page.tsx:24`, `question-banks/page.tsx:58`); CSV/xlsx download helpers defined inline in `pools/page.tsx:10-11` while import UIs for roster/students/programs/pools each re-implement file read + preview + submit; `<Table>` column arrays and filter bars (search/status/institution/program + `useUrlState` in 14 files) repeated per page; Field-level validation done ad hoc per form.
- Impact: review and defect-finding cost; `any` pervasive (`useGet<any>`, `(r: any)` in most pages), so API/UI drift is not caught by TypeScript. The shared DTOs in `@oes/shared` are used in only a few files (`exams/page.tsx:8`).
- Recommendation: split player (Player/ReviewView/ReceiptView/Lobby are already separate functions, move to files), extract ImportDialog, ImageView, FilterBar; type API responses from shared DTOs; enable prettier/eslint max-len.
- Tag: VERIFIED.

### FE-04 MEDIUM — Exam paper builder silently truncates the question bank at 200
- Where: `apps/web/src/app/(app)/exams/[id]/page.tsx:17` requests `/questions?status=APPROVED&courseId=…&pageSize=200` with no pager.
- Impact: a course with more than 200 approved items shows only 200 (search/difficulty filters narrow it, but there is no "more" affordance), so lecturers can be unable to select valid items. Whether the API caps pageSize lower than 200 was not checked.
- Recommendation: add Pager or "load more"; show total.
- Tag: VERIFIED (client side); API cap unverified.

### FE-05 MEDIUM — Network/5xx failure of `/auth/me` is treated as "signed out"
- Where: `session.tsx:21` (`catch { setMe(null) }`) + `:29` redirect to `/login`.
- Impact: any transient failure of `/auth/me` (offline reload, 502 during deploy) sends the user to the login page, including a candidate reloading mid-examination; session cookie is still valid and the exam buffer persists, but the candidate is bounced and may lose time while the server clock runs. Only 401 should clear the session; other errors should show a retry state.
- Recommendation: distinguish ApiError status 401 from other errors; keep `me` unknown and show retry UI.
- Tag: VERIFIED.

### FE-06 LOW — Session-expiry event fires from exam saves and bounces the candidate
- Where: `api.ts:23` dispatches `SESSION_EXPIRED_EVENT` on any 401 UNAUTHENTICATED (including `PUT /attempts/:id/answers/:qid`); `session.tsx:25` sets `me=null`, `:29` redirects to `/login`, unmounting the Player.
- Impact: expiry/revocation mid-exam yields redirect to login with the answers held only in the localStorage buffer (restored on resume by `exam-engine.ts:257-263`). Behaviour is coherent but not tested here; the candidate sees the generic "session ended" note rather than exam-specific guidance.
- Tag: VERIFIED (code path); that the API returns that exact code for expiry is ASSUMPTION.

### FE-07 LOW — Answer buffer in localStorage is not user-scoped and survives abnormal exit
- Where: `exam-engine.ts:250-256` key `oes:buffer:<attemptId>`; cleared in `clearBuffer` on receipt (`exam/[examId]/page.tsx:73`).
- Impact: on a shared lab PC, un-acked answer selections of an attempt remain until restored/submitted. Contains only labels/revision, no personal data; attemptId is a server-generated id. Not authoritative (server is truth, `exam-engine.ts:43`).
- Tag: VERIFIED.

### FE-08 LOW — Option buttons use `role="radio"` without radio-group keyboard behaviour
- Where: `exam/[examId]/page.tsx:226-227, 270-271`.
- Evidence: each option is a `<button role="radio" aria-checked>` inside `role="radiogroup"`; no arrow-key roving tabindex handler found. Every option is a separate tab stop.
- Impact: ARIA pattern mismatch for screen-reader/keyboard candidates (still operable with Tab/Space). Shortcut handler at `:158-165` provides other keys.
- Tag: VERIFIED.

### FE-09 LOW — Mobile navigation drawer has no focus trap / inert background
- Where: `(app)/layout.tsx:72-78` (Escape + body scroll lock only), `:99` scrim is `aria-hidden` click target.
- Impact: Tab can reach page content behind the open drawer. The Modal component does trap focus (`ui.tsx:162-169`) and the exam palette sheet takes focus (`exam/[examId]/page.tsx:123`).
- Tag: VERIFIED.

### FE-10 LOW — Backend features with no UI (not placeholders; the reverse of the usual gap)
- Endpoints with no frontend caller (grep of `apps/web/src`): `POST /auth/mfa/disable`, `POST /auth/mfa/reset/:userId`, `GET /reports/institutions`, `GET/POST /institutions/:id/departments`, `POST /directory/reassign-students`, `GET /exams/:id/roster-versions`, `GET /exams/:id/eligibility-overrides`, `GET /invigilation/exams/:id/monitor`, `POST /notifications/broadcast`.
- Impact: a staff member who loses their authenticator cannot be reset via UI (only direct API); broadcast and reassign features unreachable by users; docs listing these as features would be overstated. 
- Tag: VERIFIED (absence by grep); whether docs claim them not checked.

### FE-11 LOW — All GET failures need manual retry; no caching; notification poll runs while tab hidden
- Where: `api.ts:40-55` (single attempt), `(app)/layout.tsx:19` (30 s `setInterval`, never paused on `document.hidden`), `/me/exams` re-fetched on every page that needs it, `/me/results` fetched in the shell (`layout.tsx:80`).
- Impact: extra load at scale (each open tab polls /notifications every 30 s); transient errors surface as ErrorBox with a Try again button. Acceptable at current scale; will matter for thousands of concurrent students. Exam traffic itself is separate and well-behaved (heartbeat 15 s).
- Tag: VERIFIED.

### FE-12 LOW — Security header set is good but incomplete
- Where: `next.config.mjs:9-13` (XFO DENY, nosniff, Referrer-Policy same-origin, HSTS `max-age=31536000` only in production, no `includeSubDomains`/preload), no `Permissions-Policy`, no COOP/CORP. CSP in `csp.ts:23-39` is strong (nonce + strict-dynamic, no unsafe-inline/eval in prod, `frame-ancestors 'none'`, `object-src 'none'`, `connect-src 'self'`); only relaxation is `style-src-attr 'unsafe-inline'` (`csp.ts:29`, documented in docs/audit/stabilization/05-csp-review.md). nginx snippet sets Referrer-Policy again (`infra/hostinger/nginx/snippets/oes-security-headers.conf:7`) — I did not review the rest of that file.
- Recommendation: add `Permissions-Policy` (camera/microphone/geolocation off), consider `Cross-Origin-Opener-Policy`, no CSP `report-to` endpoint exists (violations are invisible).
- Tag: VERIFIED.

### FE-13 LOW — External link from directory data rendered without scheme check
- Where: `(app)/institutions/page.tsx:124` `<a href={r.source.url} target="_blank" rel="noreferrer">`.
- Impact: URL comes from imported directory data (staff-controlled). React 19 and CSP block `javascript:` execution, so exploitability is low; still prefer an https-only check. `rel="noreferrer"` implies noopener.
- Tag: VERIFIED.

### FE-14 INFORMATIONAL — Question content is plain text only
- Where: `exam/[examId]/page.tsx:223-225` renders `q.vignette`, `q.stem`, `o.text` as React text; the `Q` interface (`:14`) has no image/media field, while teacher editors support image attachments (`pools/page.tsx:24,178`; `/teacher/images`) and CSP allows `CSP_MEDIA_ORIGIN` (`csp.ts:30-31`).
- Impact: XSS-safe by construction (no `dangerouslySetInnerHTML` anywhere in `apps/web/src`), but images/formulas/formatting attached to bank questions are not shown to candidates in this player. Whether items copied into exam papers carry images was not verified.
- Tag: VERIFIED (client); impact on content ASSUMPTION.

### FE-15 INFORMATIONAL — Authenticated question images and photos travel as base64 data URLs in JSON
- Where: `image.ts:1-11` (≤150 KB JPEG data URL), `pools/page.tsx:24` `st.data.data`.
- Impact: no `next/image` usage (only brand logos, `brand.tsx:1`); acceptable for small avatars, inflates payloads for image-heavy banks.
- Tag: VERIFIED.

### FE-16 INFORMATIONAL — No dark mode or `prefers-color-scheme`; contrast not computed
- `globals.css` contains `prefers-reduced-motion` (`:77`) but no `prefers-color-scheme`. Tokens `--ink-2 #5E4E4B`, `--ink-3 #665855` (`:4`) look sufficient but I did not compute ratios against `--ivory`. Axe is wired (`@axe-core/playwright` 4.14.0, root `package.json:40`; used in ~10 e2e specs, e.g. `tests/e2e/a11y-lists.spec.ts`), but I did not run it.
- Tag: ASSUMPTION for contrast.

## 3. Page inventory
Roles come from `apps/web/src/nav.ts` NAV + ROUTE_RULES permission (shell shows NoAccess page before rendering, `(app)/layout.tsx:85,106`); API stays the authority. Status: W = working (all called endpoints exist in a controller), P = partial. No placeholder pages found: every page calls real endpoints, none returns mock data (grep for mock/fixture/TODO in apps/web/src finds none that stub data — not exhaustively verified for every string). Lines = `wc -l`.

| Route | Portal | Roles (nav) | Main API calls | Endpoint exists | Lines | Status |
|---|---|---|---|---|---|---|
| / | both | any | redirect to /dashboard | n/a | 2 | W |
| /login | both | public | POST /auth/login | yes | 39 | W |
| /forgot | both | public | POST /auth/forgot, verify-code, reset | yes | 69 | W |
| /register | student | public candidate | POST /auth/register, /register/verify | yes | 74 | W |
| /register/teacher | student | public teacher | GET catalog, POST /teacher-registration, /verify | yes | 190 | W |
| /verify | both | public | GET /public/verify | yes | 23 | W |
| /mfa | both | any signed in | POST /auth/mfa/setup,enable,verify | yes (disable/reset have no UI, FE-10) | 62 | W |
| /complete-profile | student | STUDENT | GET /onboarding/catalog, POST /onboarding/complete | yes | 92 | W |
| /dashboard | both | all | /dashboard, /me/exams, /notifications, /invigilation/exams, /teacher/overview | yes | 142 (+41) | W |
| /profile | both | all | POST /auth/change-password, PATCH /auth/profile, POST /student/change-request, GET/PATCH /teacher/profile | yes | 69 (+35) | W |
| /help | both | all | none (static) | n/a | 35 | W |
| /schedule | student | STUDENT | GET /me/exams | yes | 37 | W |
| /results | student | STUDENT | GET /me/results | yes | 23 | W |
| /performance | student | STUDENT | GET /me/results | yes | 30 | W |
| /certificate/[id] | student | STUDENT | GET /me/results/:id/certificate | yes | 27 | W |
| /exam/[examId] | student | STUDENT | GET /me/exams, state, SSE stream; POST /attempts/start, heartbeat, events, submit; PUT answers; GET sheet, receipt | yes (all) | 369 | W (oversized) |
| /questions | staff | LECTURER, EXAMINER | GET/POST/PUT/DELETE /questions, review, submit, duplicates | yes | 118 | W |
| /my-courses | staff | LECTURER | GET /me/course-assignments | yes | 21 | W |
| /exams | staff | LECTURER, EXAMINER, CAMPUS_ADMIN, CCE, SUPER_ADMIN | GET/POST /exams, /institutions, /programs | yes | 58 | W |
| /exams/[id] | staff | same | exams CRUD, paper, schedule, cancel, roster, invigilators, grading key-actions/review, results approve/publish, /users | yes | 200 | P (200-item cap, FE-04) |
| /exams/[id]/control | staff | exam.control.view | /exams/:id/control + commands, extend preview, policy, SSE, candidates | yes | 239 | W |
| /monitor | staff | EXAMINER, CAMPUS_ADMIN, INVIGILATOR, CCE, SUPER_ADMIN | GET /invigilation/exams | yes | 16 | W |
| /monitor/[examId] | staff | same | snapshot, candidates, SSE, extend, force-submit, /incidents | yes | 51 | W |
| /incidents | staff | invigilation roles | GET/PATCH /incidents, notes | yes | 26 | W (unpaginated) |
| /students | staff | LECTURER, CAMPUS_ADMIN, SUPER_ADMIN | /students, import, PATCH | yes | 42 | W |
| /students/[id] | staff | same | GET /students/:id | yes | 45 | W |
| /roster | staff | CAMPUS_ADMIN, SUPER_ADMIN | GET /roster, POST /roster/import | yes | 171 | W |
| /enrolment | staff | CAMPUS_ADMIN, CCE | /enrollments/bulk, attendance, condone, /institutions, /programs | yes | 43 | W |
| /assignments | staff | CAMPUS_ADMIN, SUPER_ADMIN | /course-assignments, /institutions, /programs | yes | 38 | W |
| /users | staff | CAMPUS_ADMIN, SUPER_ADMIN | /users, PATCH, reset-password | yes | 42 | W |
| /teachers | staff | CAMPUS_ADMIN, SUPER_ADMIN | /admin/teachers (+decision, suspend, pools, activity, assignments) | yes | 102 | W |
| /classes | staff | TEACHER | GET /teacher/assignments | yes | 38 | W |
| /pools | staff | TEACHER | /teacher/pools, questions, import/export, images, versions | yes | 269 | W (oversized) |
| /my-students | staff | TEACHER | /teacher/assignments, /teacher/students | yes | 27 | W |
| /submissions | staff | TEACHER | GET /teacher/submissions | yes | 41 | W |
| /question-banks | staff | EXAMINER, CCE, SUPER_ADMIN | /question-banks list/review/images | yes | 136 | W |
| /institutions | staff | all staff incl. LECTURER | /directory/*, /institutions CRUD | yes | 179 | W (dense) |
| /programs | staff | all staff | /programs, courses, bulk | yes | 60 | W |
| /audit | staff | CAMPUS_ADMIN, CCE, SUPER_ADMIN | GET /audit, /audit/verify | yes | 36 | W |
| /not-found, error, global-error, (app)/error | all | n/a | none | n/a | 15/17/16/16 | W |

Every frontend call I extracted matches a controller route in `apps/api/src/modules/**/*.controller.ts` (including multi-controller prefixes `teacher`, `admin/teachers`, `question-banks`, `directory`); I found no frontend call to a non-existent endpoint.

## 4. Controls verified as working (code evidence)
- Strict nonce CSP per request, no unsafe-inline/eval in production (`csp.ts:23-39`, `proxy.ts:7-11`); no `dangerouslySetInnerHTML`/`innerHTML` in app source; e2e `tests/e2e/csp.spec.ts` exists.
- No tokens or secrets in JS-readable storage; API reached through same-origin rewrite (`next.config.mjs:7`), `API_INTERNAL_URL` server-only; only public portal URLs are `NEXT_PUBLIC_*`. `poweredByHeader:false`.
- No open redirect: client redirects use fixed literals; notification links gated by `isSafeAppLink` (`packages/shared/src/links.ts:21`, used `(app)/layout.tsx:45`, `dashboard/page.tsx:89`).
- Exam client: server-clock offset and server deadline (`exam-engine.ts:60,73-74`), re-synced on every save and 15 s heartbeat; per-question monotonically increasing revisions with idempotent retries; exponential backoff with jitter (`:115`); 12 s save timeout with ambiguous-outcome reconciliation against `/sheet` (`:189-204`); max 4 concurrent saves (`:110`); offline/online handling and honest save banners; suspension freezes input and clock per policy (`:208-215`); localStorage only as a crash buffer; other-window takeover detected (`SESSION_SUPERSEDED`); double-submit protected by `busy` state plus a persisted `submitKey` reused across 6 retries (`page.tsx:116,301-307`); submit first flushes and warns on unconfirmed answers; time-up path flushes then polls server and fetches receipt rather than trusting the browser (`page.tsx:147-152`); unload/reload resumes (`:55-60`).
- Route guards: shell NoAccess before render (`layout.tsx:85,106`); teacher-approval gating (`:84`); forced password change (`:106`); MFA and onboarding redirects (`session.tsx:30-38`) — no redirect loop found: all targets (`/login`, `/mfa`, `/complete-profile`) are either public or excluded from their own redirect condition.
- Error boundaries at three levels: `app/global-error.tsx`, `app/error.tsx`, `(app)/error.tsx`; error text never leaks stack, only digest. `ErrorBox` classifies offline/403/404/5xx; `SlowLoading` after 8 s.
- `useGet` has a sequence guard against stale responses (`api.ts:43-50`).
- Accessibility: skip link and focusable `<main id="main" tabIndex=-1>` (`layout.tsx:89,106`), labelled Field with aria-required/invalid, Modal focus trap + restore + Escape + unsaved-changes guard (`ui.tsx:156-183`), sortable-less tables with `scope="col"`, keyboard-reachable scrolling tables (`ui.tsx:112-125`), `aria-current` nav, `role="timer"`, live regions in player, `:focus-visible` (`globals.css:16`), page titles per page (`ui.tsx:31`), reduced-motion. Axe via Playwright in ~10 specs.
- Responsive: nav drawer below 1024 px (`layout.tsx:71`), tables collapse to labelled cards with "Show details" (`ui.tsx:122-128`, `globals.css:73-74,517`), palette bottom sheet at 960 px in the player (`page.tsx:121`).
- Client-side validation uses shared helpers (`checkPassword`, `isValidPhone`, `itemWritingChecks`) from `@oes/shared` with server zod as authority (delivery.controller.ts uses zod; other controllers not reviewed here). Browser-safe barrel guarded by `packages/shared/src/browser-safety.test.ts`.
- Spreadsheet import hardening: size/entry/row caps, zip-bomb guard, DOMParser only (`xlsx-lite.ts:8-9,16-26,52-57`); writer uses inline strings so cells cannot be formulas (`:5`).
- Pagination (`Pager`, pageSize 20-50) on 12 list pages; list state in URL (`url-state.ts`, 14 pages).

## 5. Could not verify
- Runtime behaviour (no servers started): real offline/reconnect, SSE reconnect, mobile rendering, axe results, bundle sizes (`next build` not run; no `@next/bundle-analyzer`).
- Cookie flags (httpOnly/SameSite/Secure) and CSRF defences — API side. Server-side rejection of wrong-role/portal requests.
- Whether exported CSV (`GET /teacher/pools/:id/export`, `/reports/exams/:id/csv`) neutralises spreadsheet formula injection (server-built).
- Colour-contrast ratios of the token palette; screen-reader behaviour of the player.
- API maximum `pageSize` (affects FE-04) and whether exam papers carry question images (FE-14).
- Pages for dashboards beyond `dashboard/page.tsx`/`TeacherOverview.tsx`: spot-read only; the many dense line-wrapped pages were scanned through grep of calls, not read line by line.
