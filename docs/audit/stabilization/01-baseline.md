# 01 — Baseline and verification of the audit's findings

Phase 21, 2026-10-31. Evidence labels: **TODAY** = executed in this phase; **SOURCE** = read from code.

## Starting state (TODAY)

| Item | Value |
|---|---|
| Branch / HEAD at start | `claude/oes-platform-foundation` @ `5b87741` (the all-questions view); origin identical |
| Working tree | only the 19 audit documents untracked |
| Container | had **restarted** again (uptime 0 min): dev PostgreSQL `oes` (:5433) and Redis (:6390) were down; restarted with `pg_ctlcluster 16 oes start` / `redis-server`; **no data touched** |
| Shared dev database | intact: 12,023 users, 12,000 attempts. **Not modified in this phase** (no migration, no seed, no test points at it) |
| Running tests/bench at start | none |
| Backup of the shared dev DB | none existed. Took one with `scripts/db-backup.mjs` (outside the repo, `/tmp/stab-backup`): 50,387,488 bytes, 36 tables, 1,410,540 rows, **verified by isolated restore** (checksum, content fingerprints, migrations, triggers, append-only: all true) |
| Disposable infrastructure | PostgreSQL :54397 + Redis :6397 under `/tmp/stab-live` (script `/tmp/stab-stack.sh`), used for Playwright; the test database `szabmu_oes_test` / Redis DB 1 for API tests; the fault harness creates its own clusters |
| Process hygiene | no `pkill -f` used; stray servers stopped by explicit PID after checking `cwd` and start time |

## The audit documents (TODAY)

19 files, 1 commit (`bfece18`, documentation only, **not pushed**). Scan for secrets/credentials/personal data: the only matches were prose words (`password`, `token`, `secret`) in descriptions; the demo password constant is not present; no emails other than the synthetic `*@demo.szabmu.invalid` pattern; no long high-entropy strings; no student data.

## Each reported finding, re-verified against the repository

| Finding | Verified? | Notes |
|---|---|---|
| Lint: six failures in `bench-main.cjs` | **Confirmed** | `no-undef` ×6 at lines 4,5,6,7,12,12 (`require` ×3, `process` ×2, `console`) |
| Fault suite exits 1 with passing assertions | **Confirmed** | unhandled `Connection terminated unexpectedly` from the harness's own `pg.Pool` when the DB is crashed on purpose |
| Playwright 16/17, MFA leakage | **Confirmed** | `auth.spec` enrolled `invigilator.b`; `staff.spec` later logged in as it → `/mfa` |
| `GET /reports/institutions` leaks other campuses | **Confirmed, root cause found** | controller `inst()` took no user; service had no scope parameter (`reports.controller.ts`, `reports.service.ts`) |
| Missing CSP | **Confirmed** | web sent only XFO/nosniff/Referrer-Policy |
| Six broken notification links | **Understated** | **11** call sites stored links to non-existent pages, and the web UI **never rendered the link at all** |
| No error/not-found pages | **Confirmed** | no `error.tsx`, `not-found.tsx`, `global-error.tsx` |
| Favicon 404 | **Confirmed** | no icon in `app/` |
| Missing exam control, Redis sweeper, polling monitor, operations | Not in scope | tracked in `07-remaining-risks.md` |
| Mobile examination usability | Not in scope | tracked in `07-remaining-risks.md` |

## Findings not in the audit, discovered while fixing

1. **Exam detail/list leaked other campuses** (participating-campus list, candidate and attempt counts) to campus-scoped staff — found by the new structural sweep, fixed with the same change set.
2. **`node:crypto` was bundled into the browser** (the `@oes/shared` barrel re-exported server-only HMAC/digest code): a 457,695-byte client chunk with a crypto polyfill and a CSP `eval` report on every page. Fixed.
3. The audit's "Examiner `/results` has no heading" was a heading-level artefact of my probe (it only looked for h1/h2); not a defect fixed here.

## Audit statements corrected by this phase

- `docs/audit/current-build-analysis/04` and `13` say six dead notification links; the real number is eleven (plus the unrendered link).
- `02-git-and-build-status.md` records HEAD `d85e3a3`: accurate when written; HEAD is now later (see `06`).
