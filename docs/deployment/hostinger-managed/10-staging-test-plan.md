# 10 — Staging test plan

**Status: NOT RUN.** Nothing below has been executed. Staging uses Hostinger's temporary `*.hostingersite.com` hostnames, a **separate** staging PostgreSQL and Redis, synthetic data only, and approved credentials. No DNS change and no production migration are part of staging.

Record for each test: date, commit SHA, operator, result, evidence (command output / screenshot / log excerpt). A test without evidence did not pass.

## A. Platform and routing
| ID | Test | Pass condition |
|---|---|---|
| A-0 | Three sites build and start on **Node 24** with Config A (doc 03); fall back to Config B / entry packages if not | all three show a running app; record exact hPanel values |
| A-1 | Does the Next `rewrite` forward `Origin`, cookies and `Set-Cookie` to an external API origin? (browser dev-tools + API logs) | cookie set on the **portal** host; `Origin` visible to the API |
| A-2 | Does `proxy.ts` / a BFF handler get its request headers forwarded to the external rewrite target? | decides Mode 1 vs Mode 2 (doc 06) |
| A-3 | SSE through the platform: open the monitor stream, hold 5 minutes, count disconnects, check `Last-Event-ID` replay and **buffering** (events arrive immediately, not in bursts) | stable, or documented cut at 120 s with clean reconnect; else set polling-only |
| A-4 | `X-Forwarded-For` chain: send a forged header, read what the API sees | decides the hop-count fix (B-06) |
| A-5 | Response headers: HSTS, CSP nonce, `Cache-Control` on `/api/*` | present; `no-store` on authenticated responses |

## B. Authentication
| ID | Test | Pass condition |
|---|---|---|
| B-1 | Student signs in on the student host only; staff on the staff host only | wrong-portal sign-in returns the same error as a bad password; audit row `auth.login_wrong_portal` |
| B-2 | Cookie jars: `oes_session` exists only on `oes.`; none on `dashboard.`/`api.` | verified in the browser |
| B-3 | Replay a student cookie against the staff site and the API | 403 / 401; no staff data |
| B-4 | Staff MFA enrolment and sign-in for all four enforced roles | works; recovery codes shown once |
| B-5 | Password recovery end to end through the real mail path | mail received; token single-use; Redis flushed mid-flow fails cleanly |
| B-6 | Logout and admin deactivation | other tabs lose access immediately |
| B-7 | CSRF: POST with a foreign `Origin`; POST with no `Origin` | foreign refused; decide on no-Origin (G6) |

## C. Examination reliability (synthetic candidates; non-destructive to shared infrastructure)
Run the 14-step scenario in `reliability-test-results.md` plus:
| ID | Test | Pass condition |
|---|---|---|
| C-1 | Student starts, saves, changes, skips, flags, submits; receipt returned; examiner sees the submission | all steps; receipt code stable on replay |
| C-2 | Kill/restart the API site mid-exam (hPanel restart); browser reconnects | **every acknowledged answer present**; no duplicate attempt |
| C-3 | Stop the external worker for > the deadline; submit late save | late save refused (deadline); attempt sealed by the next request or the reconcile cron; graded **once** after the worker returns |
| C-4 | Make Redis unavailable (staging only, by credential revoke) | saves continue; recovery fails visibly; monitor degrades; recovery after restore |
| C-5 | Reconcile cron: run `npm run reconcile` twice concurrently | one reports `skipped`; no duplicate work |
| C-6 | Load: the existing `tests/load/exam-load.mjs` at stepped sizes (200 → 500 → 1 000 → 2 000) against the **real** staging stack | error rate, save p99, Hostinger process/CPU limits hit or not; the **observed** ceiling is the only capacity claim |

## D. Data and operations
| ID | Test | Pass condition |
|---|---|---|
| D-1 | `prisma migrate deploy` against the empty **staging** DB from CI/workstation; first-admin bootstrap (when implemented) | schema + triggers present; `GET /api/audit/verify` clean |
| D-2 | Provider backup restored to a scratch instance; run `backup:verify`-style fingerprint comparison | identical counts/fingerprints; RTO measured |
| D-3 | Roll back: redeploy the previous Git commit on each site | previous version serves; DB compatible |
| D-4 | Alerts: kill the DB connection, fill the outbox, delay the worker | alerts fire (rules in `infra/observability/alerts.yml` adapted to the hosting) |

## Exit criteria for a controlled pilot
A-0…A-5 resolved and documented; B-1…B-7 pass; C-1…C-5 pass; C-6 shows headroom over the pilot size with margin; D-1…D-3 pass; every blocker in `release-blockers.md` closed or explicitly accepted in writing by the university.
