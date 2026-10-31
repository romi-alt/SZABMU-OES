# 17 — Readiness scorecard

Engineering assessment on 0–10, **not a certification**. Scores are deliberately conservative where evidence is single-machine/synthetic. `NOT_ASSESSED` is used where there is no evidence.

| # | Category | Score | Evidence | Reasoning / major risk | Missing for 10/10 |
|---|---|---|---|---|---|
| 1 | Frontend functionality | **6** | 16/17 e2e, 68 clean loads, full player | Real role UIs, no mock data; no browser spec for create→schedule→publish; no boundaries; mobile shell | operator UI for exam control, error boundaries, mobile nav, broader specs |
| 2 | Backend architecture | **7** | deny-by-default manifest, SoD, scoping, idempotency | Clean modules; lifecycle coupled to one Redis scheduler; unbounded monitor query | DB-driven lifecycle fallback, bounded reads, structured logs |
| 3 | Database integrity | **8** | triggers, hash chain, CTE saves, restore verified | Strong invariants; no partitioning/retention; plaintext keys | journal retention, PITR, key encryption |
| 4 | Student examination engine | **8** | 4 e2e, engine tests, fault tests | Skip/sidebar/timer/submit all verified; missing: pause/resume honoured by client, images | suspend/resume semantics, image items, a11y pass |
| 5 | Answer persistence reliability | **8.5** | fault suite (DB crash, Redis, API kill, lost responses), 250 k acks | Strongest area; single-machine, synthetic; submit fix not re-measured at load | multi-host, long soak, disk-full/replica-lag faults |
| 6 | Real-time monitoring | **3** | polling endpoint, scoped rows | Works for small exams; not load-tested; no push; Redis-dependent connection state | scalable read model, SSE, load proof |
| 7 | Examination control | **3** | probes: suspend/resume/open/close/extend-all absent | Only per-candidate extend + force-submit + incidents | full audited state machine |
| 8 | Multi-campus management | **6** | isolation probes; MEDIUM D-09 | Campus scoping solid; no rooms/seats/attendance register; no Institution Admin tier | D-07, D-09, D-20 |
| 9 | Security | **6.5** | 98-route manifest, MFA, config validation, probes | No CRITICAL/HIGH found; no CSP, plaintext keys, fail-open limiter, D-09, no pen-test, no dependency re-scan today | pen-test, CSP, key encryption, hardened deployment |
| 10 | Result processing | **6** | workflow tests | MCQ grading, key actions, approval/publish, certificates verified; no corrections, no manual grading, no reconciliation test | D-08, reconciliation tests, PDF |
| 11 | UI/UX | **6.5** | screenshots | Institutional, coherent, good player; mobile shell defects; limited coverage viewed | responsive nav, polish, full visual review |
| 12 | Accessibility | **NOT_ASSESSED** | only label/alt/overflow checks | No axe/WCAG/keyboard/SR evidence | audit and remediation |
| 13 | Performance | **4** | 2 k and 5 k runs | 2 k measured; 5 k slow; 10 k/20 k untested; no profiling | dedicated-hardware runs at target |
| 14 | Testing quality | **6.5** | 171+15+10+16 pass | Strong integration/fault; one lint failure, one red e2e, one red fault exit; desktop-only UI; no sweeper/monitor tests | green CI ×2, mobile + operator specs, sweeper faults |
| 15 | Deployment readiness | **2** | compose/workflow exist, never executed | No proven deploy, no TLS/proxy, no secrets mgmt run, no migration rehearsal on prod-like | pipeline, environments, rollback |
| 16 | Operational readiness | **2.5** | metrics, runbooks, verified manual restore | No scheduling, alert firing, on-call, DR timing, log shipping | D-05 |

**Not an average-able claim.** The weakest items (control, monitoring, deployment, operations) are exactly those a supervised examination needs on day one.
