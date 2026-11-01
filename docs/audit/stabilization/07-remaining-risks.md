# 07 — Remaining risks and defects

Nothing below was changed in this phase. IDs refer to `docs/audit/current-build-analysis/16-defect-register.md`.

## Release-blocking for supervised use (unchanged, the next phase)

| ID | Item | State |
|---|---|---|
| D-01 | No suspend/resume, open/close admission, exam-wide extension, manual scoring trigger | still missing (404) |
| D-02 | All lifecycle transitions depend on one Redis/BullMQ sweeper | still true; never fault-tested |
| D-04 | Live monitor: 5-second polling, unbounded query, no push channel | unchanged |
| D-03 | 5,000 candidates correct but slow; 10,000/20,000 untested; the submit fix not re-measured under load | unchanged; no load test was run in this phase (by instruction) |
| D-05 | Backups manual/unencrypted/local, no PITR, alerts never fired against Prometheus, no CI run, no deployment path | unchanged. (A verified backup of the shared dev DB was taken as a protective step.) |

## Security items still open

| Item | Notes |
|---|---|
| Answer keys plaintext at rest (P-27, `D-13`) | unchanged; needs a policy decision |
| Rate limiters fail open when Redis is down (P-28, `D-16`) | unchanged |
| `style-src-attr 'unsafe-inline'` | the one deliberate CSP relaxation; remove by moving the 63 inline style attributes to classes |
| CSP verified in Chromium only; no violation-reporting endpoint | see `05` |
| New aggregate/export/stream endpoints (PDF, file download, SSE) | none exist today; each must be added to the scope sweep in `campus-isolation.test.ts` when created |
| Scope is enforced per query, not by database row-level security | the new sweep detects regressions on the listed GET routes only; a route not in the list is not covered |
| No independent penetration test; `npm audit` not re-run | unchanged |
| Brief's "Institution Admin" role | does not exist; Campus Admin with several `user_institutions` rows is the closest. A distinct tier is a policy/design decision (`D-20`) |
| CCE "within assigned authority" | CCE is university-wide by role; there is no per-CCE institution assignment in the data model |

## Quality items found while doing this work (not fixed)

| Item | Notes |
|---|---|
| A page the user may not use still renders its chrome (e.g. `/users` shows "+ New account" and filters to a student, followed by the access-denied panel) | no data is exposed — the API refuses — but the page should not render for a role without the permission. Needs route-level permission gating in the shell. |
| Mobile/tablet shell and the exam palette below the fold on phones (`D-14`) | unchanged |
| Reverse-order Playwright runs cannot be forced with this runner | independence is structural (disjoint users, teardown) |
| Browser seed now defaults to 8 students per campus (API tests keep 6) | `SEED_STUDENTS_PER_CAMPUS` overrides |
| Favicon is a crop of the approved logo lockup | replace with an official university favicon when supplied |
| `docs/audit/current-build-analysis/` figures that are now outdated | e.g. "6 dead links", "lint fails", "16/17" — they describe the build at `d85e3a3`; this phase's documents supersede them |
| The load driver and dev database still hold 12 k load-test users and `LIVE` `LOAD-*` exams (`D-18`) | unchanged; preserved on purpose |

## What these fixes do **not** establish

All results are on synthetic data, one machine, Chromium. They remove known defects and add regression guards; they do not demonstrate capacity, operational readiness, accessibility conformance or resistance to an independent attacker. See `06` for the classification.
