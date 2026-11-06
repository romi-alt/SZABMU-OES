# Production readiness checklist

A real examination may run only when every **Required** item is ✅ with evidence. Status as of 2026-11-06; product classification **INTERNAL_TESTING_READY**.
✅ done with evidence · ⚠️ partly / done locally only · ❌ not done · ⛔ blocked on a decision or access.

## A. Required before any real candidate

| # | Item | Status | Evidence / what is missing |
|---|---|---|---|
| A1 | All quality gates green on the release commit, including CI on MariaDB 11.8 | ⚠️ | local gates green (`docs/audits/IMPLEMENTATION_TRACKER.md` §3); CI run on the release commit pending |
| A2 | Durability fault suite passing on MariaDB | ⚠️ | ported (T-QA-01); results in the tracker |
| A3 | Load test on a staging copy of the hosting with the expected cohort and start pattern | ❌ | only local measurements |
| A4 | API in production mode (`NODE_ENV=production` → `productionProblems()` config gate) | ❌ | demo runs development mode |
| A5 | MFA enforced for SUPER_ADMIN, CCE, EXAMINER, CAMPUS_ADMIN (`MFA_ENFORCE=true`) | ❌ | off on the demo |
| A6 | Portal enforcement on (`PORTAL_ENFORCE=true`, `PORTAL_HOSTS`) | ✅ | live check 2026-11-01 |
| A7 | Correct client IP behind the proxy (SEC-08) | ❌ | hop count to be measured |
| A8 | Email delivery verified end to end (sign-up and reset codes arrive; SPF/DKIM) | ⛔ | needs hPanel access and a test inbox |
| A9 | Secrets: independent random values for `COOKIE_SECRET`, `RECEIPT_SECRET`, `MFA_KEY`, `METRICS_TOKEN`; none in git | ⚠️ | not in git (checked); values not reviewed |
| A10 | Real (non-demo) database with no seeded accounts; first administrator created by a documented bootstrap | ❌ | release blocker B-05 |
| A11 | Backup schedule + a successful restore drill (`db-backup.mjs verify`) on production-sized data | ❌ | |
| A12 | Rollback rehearsed (`ROLLBACK_AND_RECOVERY.md` §2) | ❌ | |
| A13 | Monitoring and alerting on health, error rate and save latency | ❌ | needs an external service (approval) |
| A14 | Written authorization from the university for a live examination | ⛔ | B-15 |
| A15 | Examination-day runbook: who suspends/extends, incident path, communication | ❌ | |

## B. Required before high-stakes, large examinations

| # | Item | Status |
|---|---|---|
| B1 | Capacity envelope known for the start burst; staggered starts configured if needed | ❌ |
| B2 | Manual screen-reader pass of the exam journey; accommodations (extra time) tested | ⚠️ automated scans only |
| B3 | Lockdown-browser decision (Safe Exam Browser) for on-site exams | ⛔ policy |
| B4 | Answer-key encryption at rest decision (P-27) | ⛔ policy |
| B5 | Independent security review / penetration test | ❌ |

## C. Already in place (evidence)
Server-clock timing, revisioned autosave, seal-once receipts, frozen papers, exam control state machine, campus isolation, deny-by-default
authorization, hash-chained audit log, four-eyes publication, brute-force protections (SEC-03/04/06/07) — see `docs/audits/`.
