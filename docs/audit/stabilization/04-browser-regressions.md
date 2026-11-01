# 04 — Browser tests: isolation and new coverage

## The state leak

`auth.spec.ts` "two-factor" enrolled `invigilator.b` in MFA and never removed it. `staff.spec.ts` "invigilator monitors only their campus" later signed in as `invigilator.b`, was routed to `/mfa`, and `login()` (`toHaveURL(/dashboard/)`) failed → 16/17.

## Fix: unique user + controlled teardown

- The MFA spec now uses **`examiner2`** (seeded, an MFA-enforced role, used by no other spec).
- `test.afterAll` removes the enrolment through the **real admin endpoint** (`POST /api/auth/mfa/reset/:userId`, signed in as `super.admin`), so the suite also survives a retry on the same database. No application code was touched; MFA enforcement was not weakened.
- Every spec that changes a candidate's state owns a candidate nobody else uses. The browser seed now creates **8 students per campus** (`SEED_STUDENTS_PER_CAMPUS`, default 8 for Playwright; API tests keep 6), giving candidates `a002..a008` / `b002..b008`; the all-questions spec uses `b007`, the CSP spec `b008`. (A first full run failed 28/29 because my all-questions spec had submitted as `b006`, which the staff withdraw-admission spec needs un-submitted — see `06`.)

## Verification (TODAY, disposable PostgreSQL/Redis, `playwright test`)

| Scenario | Result |
|---|---|
| MFA spec alone | pass; afterwards `examiner2.totpEnabledAt` is NULL (checked in the database) |
| Invigilator spec alone | pass |
| Both together | pass |
| Reverse order | **not achievable** with this runner: `--test-list` still executes in file order (`auth` before `staff`). Independence is structural (disjoint users, teardown) and demonstrated by each-alone + together. |
| Full suite, run twice | see `06-complete-test-results.md` |

## New browser coverage added in this phase

| Spec | Covers |
|---|---|
| `exam-all-questions.spec.ts` (earlier in the session) | all-MCQs-on-one-page view: answer, skip, mark, palette jump, reload, review, submit |
| `csp.spec.ts` (4) | strict header on real responses, per-request nonce present on real `<script>` tags, no `unsafe-inline`/`unsafe-eval` for scripts, header on authenticated and 404 pages, none on the API; **zero CSP violations** across login, dashboard, schedule, results, performance, profile, exam player (both layouts, answer, review), MFA page, and admin/examiner/CCE pages; favicon 200 and no 404 on any page |
| `notifications.spec.ts` | clicking a notification opens an existing page and marks it read |
| `errors.spec.ts` (6) | 404 page, 403 panel, expired session → sign-in with explanation, offline panel + retry, 503/gateway panel + retry, error boundary inside the shell with retry; none shows internals |

The Playwright config now starts the web server with `NODE_ENV=production`, so the browser tests exercise the production CSP regardless of the invoking shell.
