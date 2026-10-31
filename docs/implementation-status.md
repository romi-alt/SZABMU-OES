# Implementation status

_Last updated: 2026-10-31 · branch `claude/oes-platform-foundation`._
Definitions — **Complete**: frontend + backend + persistence + permissions + automated tests working together against real PostgreSQL/Redis.
**Partial**: works end to end but with stated gaps. **Not started / Blocked**: see reasons. Nothing is called complete without tests.

## Verification summary
| Gate | Result |
| --- | --- |
| Typecheck (`tsc` api, web, shared) | ✅ clean |
| Lint (`eslint .`) | ✅ clean |
| Shared unit tests | ✅ 15 / 15 |
| API integration + security tests (real PostgreSQL 16 + Redis, via Fastify inject) | ✅ 96 / 96 |
| Browser tests (Playwright/Chromium → Next.js → Nest → PostgreSQL/Redis) | ✅ 13 / 13 |
| Load + integrity (2,000 synthetic candidates × 50 questions) | ✅ integrity PASS — see *Load test results* |
| Production build (`next build`, `tsc`) | ✅ |
| `docker compose` stack | ⚠️ **written but not run** — no Docker daemon in the build sandbox; PostgreSQL 16 and Redis were run natively instead |
| 20,000-simultaneous-candidate target | ❌ **not demonstrated** (see below) |

## Modules
| # | Module | Status | Notes / gaps |
| --- | --- | --- | --- |
| 1 | Authentication & recovery | ✅ Complete | Login, lockout, rate limits, OTP→token→reset, history(5), forced change, profile edit, logout revocation. **2FA not implemented (P-04)**; email delivery only to Mailpit/outbox in dev (SMTP path untested against a real relay) |
| 2 | Institutions & campuses | ✅ Complete | Register/activate; departments API (UI for departments **not built**) |
| 3 | Programs & courses | ✅ Complete | |
| 4 | Student management | ✅ Complete | Create, list/search, CSV import (all-or-nothing). No per-student edit page, photo upload (needs object storage) or transfer between campuses |
| 5 | Enrolment & eligibility | ✅ Complete | Cohort enrolment, attendance → eligibility (75 %, P-06), CCE condonation, roster refresh |
| 6 | Question bank & clinical MCQs | ✅ Complete | Author/edit/submit/review/retire; clinical vignette; four-eyes. **No CSV/bulk question import, images, multi-select, tagging UI, duplicate detection** |
| 7 | Question paper approval | ✅ Complete | Builder UI, submit, approve/return, frozen snapshot + key, approver ≠ submitter. No random-from-blueprint paper generation or multiple paper versions/sets |
| 8 | Exam scheduling | ✅ Complete | Create, cancel, roster from enrolments, accommodations (extra time), invigilator assignment. No venue/hall capacity or clash checks (deck E2 "Heads up") |
| 9 | Live exam delivery | ✅ Complete | See *Exam screen checklist*. **Mobile layout not browser-tested** |
| 10 | Answer preservation | ✅ Complete | Revisioned atomic upsert, journal, stale-tab claim, DB trigger lock, 20 engine tests + 3 browser tests + load integrity |
| 11 | Invigilation | ✅ Complete | Live monitor (5 s poll), heartbeat connection state, integrity-flag counts, +time, force-end. **No tab-switch/focus-loss breakdown columns or per-candidate timeline view** (deck E4); polling not WebSocket/SSE |
| 12 | Incident management | ✅ Complete | Report, notes, investigate/resolve/dismiss, blocks result approval, HIGH ⇒ CCE notification |
| 13 | Lecturer grading | 🟡 Partial | MCQ auto-grading, item analysis (difficulty/distribution/flags), lecturer review gate, key void/change + regrade (examiner). **Subjective/short-answer manual grading with rubrics (deck L4) not built (P-20)** |
| 14 | Result approval & publication | ✅ Complete | GRADED→reviewed→approved→published, four-eyes, incidents block, CSV export |
| 15 | Results & certificates | 🟡 Partial | Published results, certificate page (print-to-PDF via browser), serials, public verification. **No server-side PDF/QR certificate, no transcript/CGPA, no re-check requests**; "Performance" shows score chart only (no semester history/GPA/rank — needs policy) |
| 16 | Reports | 🟡 Partial | Role dashboards, exam report (mean/SD/pass rate/distribution/by-campus) API + CSV; **no charts UI beyond student performance, no scheduled/cross-exam reports** |
| 17 | Notifications | 🟡 Partial | In-app (bell, read/unread) + email outbox; broadcast API (campus-scoped). No broadcast UI, SMS, push, or user preferences |
| 18 | Audit trails | ✅ Complete | Hash-chained, append-only, scoped listing, verify endpoint/UI. Candidate lifecycle is intentionally in `attempt_events`, not the chain (scalability) |
| 19 | University-wide administration | 🟡 Partial | Institutions, programs, users, audit, cross-campus exams. **No system-settings screen / feature toggles / branding (deck M3), no global ⌘K search, no course-materials module (deck L5)** |
| 20 | Object storage | ⛔ Not exercised | MinIO in compose and S3 settings exist; nothing stores objects yet (no feature in scope required it). `@aws-sdk/client-s3` installed, **adapter not written** |

## Exam screen checklist (requirement → evidence)
| Requirement | Status | Evidence |
| --- | --- | --- |
| Numbered MCQ sidebar, direct navigation | ✅ | Playwright full-sitting test |
| Previous / Next | ✅ | " |
| Skip Question | ✅ | " (palette shows Skipped) |
| Mark / Unmark for Review | ✅ | " (corner flag toggles) |
| Clear Response | ✅ | " |
| Save and Next | ✅ | " (flushes then advances) |
| Answered / Skipped / Not Visited / Unanswered indicators | ✅ | palette classes + legend; unit test `paletteState` |
| Filters and progress counters | ✅ | Filter chips with counts + progress bar |
| Server-controlled countdown | ✅ | Clock derived from DB deadline; heartbeat resync; API test (extension reaches student clock) |
| Automatic saving | ✅ | Every selection saved; indicator tied to server ack |
| Connectivity interruption recovery | ✅ | Playwright offline→online test; exponential backoff; crash buffer |
| Final review + confirmation | ✅ | Review screen from server sheet; confirm dialog with attestation |
| Idempotent submission + receipt | ✅ | 12 concurrent submits ⇒ 1 receipt; replay returns same receipt; HMAC receipt |
| "Saved" only after durable commit | ✅ | Single-statement upsert; test "save racing submit"; load integrity |
| Duplicate requests / lost updates / stale tabs / out-of-order revisions | ✅ | `exam-engine.test.ts` (idempotent replay, 40 shuffled revisions, session takeover) |
| Never authoritative in Redis/localStorage only | ✅ | By construction; localStorage holds only unacknowledged changes |

## Load test results
Command: `npm run test:load -- --candidates 2000 --questions 50 --think 3000 --ramp 20` (synthetic candidates provisioned directly in the DB; real HTTP API, real PostgreSQL/Redis).
Environment: **one 4-vCPU / 16 GB sandbox running API (1 process), PostgreSQL, Redis and the load generator together** — i.e. pessimistic for the server, but not representative of production hardware.

| Run | Requests | Throughput | `start` p50 / p95 | `save` p50 / p95 / p99 | `heartbeat` p95 | `submit` p50 / p95 | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 — before optimisation | 139 k | 675 req/s | 6245 / 8642 ms | 9.7 / 741 / 2927 ms | 1879 ms | 1238 / 2188 ms | 0 |
| 2 — after optimisation | 138 k | 719 req/s | 153 / 1886 ms | 6.4 / 137 / 246 ms | 133 ms | 181 / 322 ms | 0 |

**Integrity (both runs): 100,000 acknowledged answers — 0 missing, 0 stale/wrong, 0 unsealed submits, 0 receipt mismatches, idempotent re-submit returned the identical receipt for all 2,000 candidates.**
This is the property that matters most: every answer the server said it stored was in PostgreSQL at the acknowledged revision.

What the first run found (and was fixed): attempt start/submit were writing to the globally serialised, hash-chained audit log (single advisory lock), which became the bottleneck.
Candidate lifecycle is now recorded on the attempt itself (`attempts`, `attempt_events`); the audit chain is reserved for staff/administrative actions. `start` was also reduced to one insert, `heartbeat` to one query + one Redis pipeline.

**Not demonstrated:** 20,000 simultaneous candidates. This run is 10 % of that target on a single shared box; extrapolation is not evidence. Remaining known costs at scale: ~100 k journal rows per 2 k candidates (`answer_events`), 2,000-candidate `start` burst p95 ≈ 1.9 s (cold paper cache + bcrypt-free but DB-bound), monitor query, and single API process. See *Next steps*.

## Known defects / limitations
- No exam-wide pause/extension tool (P-23); individual +time only.
- `answer_events` grows ~1 row per save (≈ 1 M rows for 20 k × 50); partitioning/retention not implemented.
- Monitor uses polling every 5 s; at 20 k candidates the monitor query (`GROUP BY` over answers) needs a materialised counter or Redis-backed progress.
- The heartbeat "connected" state requires Redis; without it the monitor shows candidates as disconnected (fails safe).
- Playwright suite re-seeds the **development** database (`--reset`); do not point it at shared data.
- Web has no automated accessibility audit (axe) yet and no mobile/tablet Playwright projects.
- Dev dependency advisories from `npm audit` are untriaged.
- Stack versions used were the latest resolvable on the build date; NestJS pinned to 11.x (12.x was available but unverified), TypeScript to 5.9.

## Next steps (in priority order)
1. Run the load driver in a production-like environment (multi-replica API, PgBouncer, dedicated Postgres) at 5 k → 10 k → 20 k; add `answer_events` partitioning.
2. Approve/modify the policy defaults in `docs/policy-decisions.md`; decide 2FA (P-04), retention (P-18), subjective grading (P-20).
3. Exam-wide incident controls (pause/extend), SSE/WebSocket monitor, tab-switch analytics columns.
4. Server-side certificate PDF with QR; transcripts/CGPA once grade policy exists.
5. System settings, materials (object storage adapter), global search, question bulk import.
6. Accessibility audit (axe + manual screen-reader), Urdu localisation decision, mobile test matrix.
7. Real SMTP/SMS integration tests, backup/restore drills, observability (metrics, tracing, alerting).
