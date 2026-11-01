# 04 — Frontend functional audit (by role)

Status vocabulary: VERIFIED_WORKING · PARTIALLY_WORKING · UI_ONLY · MOCK_DATA · BROKEN · NOT_IMPLEMENTED · NOT_TESTED. "VERIFIED" means demonstrated TODAY by a test run or live browser/API probe in this audit.

Method: every role signed in through the real UI on a disposable stack (clean seed); each page loaded at 390/768/1280/1600 px (68 page×width loads, `/tmp/audit-shots/report.json`); API probes; Playwright specs (16/17 pass TODAY); source read. No page uses mock data: all web pages call `/api` (`apps/web/src/api.ts`); grep for TODO/FIXME/MOCK/PLACEHOLDER over `apps/*/src` found **no** real markers (the only hits are the argon2 timing `DUMMY` hash and `temporaryPassword` fields).

| Role | Pages (route → API) | Verified TODAY | Not demonstrated |
|---|---|---|---|
| **Student** | `/dashboard`, `/schedule`, `/exam/[id]`, `/results`, `/performance`, `/certificate/[id]`, `/profile`, `/mfa` | Sign-in/out, schedule, full exam sitting (answer, skip, mark, clear, filter, palette, offline recovery, reload, review, submit, receipt), second-window takeover, deadline auto-submit, 6 h clock manipulation (Playwright 4 specs PASS); password recovery; unknown certificate rejected. Layout metrics clean at 4 widths. | Published-result view with real data (no published result in the clean seed); certificate download/print |
| **Lecturer** | `/dashboard`, `/questions` (create/edit/submit/retire), `/exams/[id]` paper build (view), `/results` review | Authors a clinical MCQ → submits → examiner approves (PASS); question list scoped to assigned courses (PASS) | Item-analysis/key-action UI by a lecturer (permission exists: `grading.review`) |
| **Examiner** | `/exams` (list/new), `/exams/[id]` (paper, roster, admission overrides, schedule, cancel), `/questions` review, `/results` (grading, key actions, approve), `/monitor` | Exam list renders; question review (PASS) | **Create exam → build paper → approve → schedule through the UI** is exercised by `workflow.test.ts` at API level only (no browser spec); `/results` page shows **no heading** at any width (TODAY report) |
| **Invigilator** | `/dashboard`, `/monitor`, `/monitor/[examId]`, `/incidents` | Own-campus monitor with a live candidate (spec FAILED on MFA pollution — product OK, see `14`); API: own-campus monitor 200 | `+ Time` / force-submit through the UI (spec did not reach it) |
| **Campus admin** | `/dashboard`, `/students`, `/enrolment`, `/users`, `/assignments`, `/results` (published only), `/incidents` | Sees only own campus; adds a student with a one-time temporary password (PASS); manages assignments for own campus (PASS) | Results view with published data; bulk student import UI |
| **Institution admin** | **No separate role exists.** `CAMPUS_ADMIN` is campus-scoped; `SUPER_ADMIN` is university-wide. `/institutions`, `/programs` are Super Admin / CCE. | — | Requirement "Institution Administrator" is **NOT_IMPLEMENTED** as a distinct role (a multi-campus scope for `CAMPUS_ADMIN` via `user_institutions` approximates it) |
| **CCE** | `/dashboard`, `/audit`, `/incidents`, `/exams/[id]` (admission override), `/results` (publish), `/programs`, `/users`(Super Admin) | Dashboard + audit-hash-chain verify (PASS); admission withdrawal with mandatory reason (PASS) | Publish through the browser; exam control (none exists — see `08`) |
| **Super admin** | all of the above + `/institutions`, `/users` | Loads (probe) | MFA reset through UI |

## Rendering and layout (TODAY, screenshots in `/tmp/audit-shots`)

- 68/68 page-width loads: **0 horizontal overflow**, **0 unlabeled inputs**, 0 images without alt; h1/h2 headings present except Examiner `/results` (no h1/h2 found; may use another heading level).
- Console: exactly one error on every page (`/favicon.ico` 404); `/users` logs a second; the login page logs the expected `/api/auth/me` 401.
- Error handling: no route-level `error.tsx`/`not-found.tsx`; a failed render falls through to the Next default. Per-page `notice.bad` states exist for API errors (PASS in specs).
- Forms: zod-validated on the server; client messages come from API error bodies. Search/filter: status filter and pagination on `/exams` verified visually; no global search.
- Exports: only `GET /reports/exams/:id/csv` (formula-injection neutralised, `reports.service.ts:104-112`). No PDF; certificate is an HTML page.

## Dead links

`notifications` rows are created with deep links that do not exist as routes: `/student/schedule` (`exams.service.ts:130`, `invigilation.service.ts:86`), `/student/results` (`results.service.ts:172`), `/cce/incidents` (`invigilation.service.ts:102`), `/cce/results` (`results.service.ts:152`), `/examiner/questions` (`questions.service.ts:96`), `/examiner/results` (`results.service.ts:~76`). The real routes are un-prefixed (`/schedule`, `/results`, …). Also, the "results ready" message embeds a raw exam UUID. (SOURCE + route listing; click-through not exercised.)
