# Implementation status

_Last updated: 2026-10-31 · branch `claude/oes-platform-foundation`._
Definitions — **Complete**: frontend + backend + persistence + permissions + automated tests working together against real PostgreSQL/Redis.
**Partial**: works end to end but with stated gaps. **Not started / Blocked**: see reasons. Nothing is called complete without tests.

## Verification summary
| Gate | Result |
| --- | --- |
| Typecheck (`tsc` api, web, shared) | ✅ clean (exit 0, checkpoint 11) |
| Lint (`eslint .`) | ✅ exit 0 (was 6 errors in `bench-main.cjs` until checkpoint 11) |
| Shared unit tests | ✅ 25 / 25 (rules incl. synchronized deadline, browser-safety guards) |
| API integration + security tests (real PostgreSQL 16 + Redis, via Fastify inject) | ✅ 237 / 237 (incl. live exam control 37, control streams 6, campus isolation 17, notification links 4) |
| Browser tests (Playwright/Chromium → Next.js → Nest → PostgreSQL/Redis, on a disposable DB) | ✅ 33 / 33, run twice consistently (incl. 4 live-control specs: central control cycle, campus/candidate boundaries, synchronized lobby) |
| Fault injection (`npm run test:fault`; disposable PG 16 cluster + Redis + real API processes) | ✅ exit 0, 17 passed + 1 skipped (durability 7, backup/restore 3, **exam control under Redis loss / API restart / two workers 3**, harness self-test 4; start-ab needs `RUN_BENCH=1`) — not part of `npm test` |
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


## Checkpoint log (resumable)
| # | Date | Commit(s) | What | State |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-31 | `61aa53e` `ea60a21` `c521f28` `c11db08` `c1458fa` | Baseline pushed: docs+audit, infra/CI, load tooling, delivery optimisation, web polish. Secret scan clean; no destructive DB change | ✅ pushed to `claude/oes-platform-foundation`; CI/compose still never executed |
| 2 | 2026-10-31 | `8eed15e` | **Eligibility policy (Decision 2)** | ✅ implemented + tested (below) |
| 3 | 2026-10-31 | `3c4f6ea` | **P0-A lecturer ↔ course authorization** | ✅ implemented + tested (below) |
| 4 | 2026-10-31 | `b4d2813` | **P0-B answer durability fault injection** (+ Redis-outage defect fixed) | ✅ 7 fault scenarios pass on disposable infra (below) |
| 5 | 2026-10-31 | `2f002c0` | **P0-C backup & verified restore** | ✅ logical backup + isolated-restore verification; ❌ PITR/encryption/scheduling (below) |
| 6 | 2026-10-31 | `6f2093f` | **P0-D (1)** config validation, route manifest, key-confidentiality sweep, dependency upgrades | ✅ (below) |
| 7 | 2026-10-31 | `6c4944b` | **P0-D (2)** TOTP MFA for privileged staff | ✅ API + browser-tested opt-in path; enforced-enrol path API-tested only |
| 8 | 2026-10-31 | `5392822` | **P0-E** metrics + alert rules | ✅ metrics tested in-process; ❌ alerts never fired against a real Prometheus |
| 9 | 2026-10-31 | see git log | **P0-F** load validation 2,000 → 5,000 | ⚠️ integrity PASS at both; **latency at 5,000 is poor on this box** (below) |

### Checkpoint 2 — eligibility admission, roster versions, overrides
**Defects found before the change:** `refreshRoster` hard-deleted candidates (history lost) and kept no version/approver; `start` only checked that a roster row existed (no account/student status, revocation, institution assignment or local enrolment re-check); no override record; no frozen per-attempt decision.
**Now:** (A) every roster build creates an immutable, SHA-256-stamped `exam_roster_versions` row approved by the scheduling actor; candidates who lose eligibility before starting are `REVOKED`, never deleted; manual (`OVERRIDE`) decisions and started candidates are never touched by refreshes. (B) A *new* attempt is admitted only if: candidate `ADMITTED`; student record belongs to the account, student `ACTIVE`, user active; student's institution participates and matches the roster row; local enrolment is `ENROLLED` and not `INELIGIBLE` (unless an override admitted them); exam window/state as before. All from local DB — no external calls. (C) The decision is stored in `attempts.admission` and is **not** re-evaluated on resume or on any save (a test asserts the save path references no enrolment/candidate data). (D) `POST /exams/:id/candidates/:studentId/override` (CCE/Super Admin only) records reason (≥10 chars), approver, timestamp, old/new decision and affected attempt in append-only `eligibility_overrides`, plus an audit-chain entry. Revoking a live attempt requires explicit `forceSubmit` (seals the attempt through the existing audited path). Granting is refused once an attempt exists (no re-entry by roster override).
**UI:** exam detail roster shows Admission + manual marker; CCE/Super Admin get Withdraw…/Admit… dialog (reason required).
**Tests:** `apps/api/test/eligibility.test.ts` (15: admission, revocation without deletion, local re-check, restricted account, frozen decision, override authorization for 5 roles + anonymous, validation, grant/revoke/not-on-roster, forceSubmit, re-entry refusal, scoping, append-only, audit) + Playwright staff spec.
**Limits / not done:** approval of a roster version is by the same actor who scheduled (single-actor — see P-24); no separate roster-approval screen or roster-version viewer in the UI; no automatic roster refresh before the exam opens (refresh occurs on *Schedule*; stale roster is mitigated by the start-time local enrolment check); suspending an in-progress attempt other than force-submit is not implemented (awaiting policy P-25); the "no academic reads on save" test is a static source check, not a runtime query counter.

### Checkpoint 3 — P0-A lecturer ↔ course authorization
**Defect (verified by reading the code, then by failing tests):** any LECTURER could create questions for *any* `courseId`, and list/read (answer keys included) every question of their institution regardless of course; paper build/read (incl. keys), item analysis, grading review and result listing were scoped by institution only. `Department` is not linked to courses in the schema, so "department" isolation is expressed through course assignment (programs/courses are university-level).
**Fix:** `course_assignments` (user, course, institution; soft revoke; partial unique index for one active row) and `CourseAccessService` as the single primitive. Enforced for lecturers in: question list (query-level filter), get/update/submit/retire (404 when unassigned), create (403, plus unknown-course 400), paper read/compose/submit, grading queue/analysis/review, result listing. Deny by default: **no assignments ⇒ no access** (including to questions they authored). Other roles are unchanged. Lecturers have no export/report permission at all (tested).
**Admin:** `POST/DELETE/GET /course-assignments` (Super Admin + Campus Admin for their own campuses only; target must be an active lecturer of that campus; audited), `GET /me/course-assignments`. UI: *Lecturer assignments* page; question bank offers lecturers only their assigned courses.
**Defect found while testing:** Prisma `OR: []` did **not** behave as "match nothing" — a lecturer with zero assignments saw all questions. Fixed with an explicit empty match; covered by a regression test.
**Behaviour change / migration note:** existing lecturers have **no** access after this migration until assigned (deliberately no auto-backfill — deny by default). The seed assigns demo lecturers.
**Tests:** `course-access.test.ts` (13: unassigned course/other campus/other program, create/update/submit/retire, key non-leakage by string search, paper/grading/results paths, admin authorization incl. other campus + anonymous, validation, immediate effect of assign/revoke, history, DB uniqueness, audit) + 1 Playwright; `security.test.ts` updated (403→404 for an unassigned course).
**Not covered / residual:** lecturers can still list *exams* (schedule metadata) of other courses at their campus; student-facing and examiner flows unchanged; no bulk assignment import; no per-term assignments.

### Checkpoint 4 — P0-B answer-durability fault injection
**Method.** `npm run test:fault` (`apps/api/test-fault/`) builds the API, creates a **disposable** PostgreSQL 16 cluster (own temp dir, random port, `fsync=on`, `synchronous_commit=on`, 127.0.0.1 only), a disposable Redis and real API child processes. Children get an explicit minimal environment and the harness refuses to run if a URL points at the shared dev/test services (ports 5433/6390). Simulated browsers keep strictly ordered per-question revisions, one in flight, and stop on first failure like the real engine. Core assertion after every fault: *every acknowledged answer is in PostgreSQL at ≥ its acknowledged revision (identical content at equal revision); every stored answer has a matching journal row; no duplicate journal rows.*
| Requested scenario | Result (measured) |
| --- | --- |
| API crash during answer writes (SIGKILL ×2, 6 candidates, random in-flight requests) | ✅ 0 acknowledged answers lost; 0 torn rows; retries converged to the full plan |
| API crash *inside* a write (journal insert stalled mid-statement) | ✅ (i) backend terminated mid-statement ⇒ neither row nor journal row, never acknowledged; (ii) API killed mid-statement ⇒ PostgreSQL finished the orphaned statement atomically (committed-unacknowledged) ⇒ retry idempotent, exactly one journal row |
| API restart after committed write (SIGTERM and SIGKILL) | ✅ sheet matches; submit with the client's expected list succeeds; receipt replays identically after another crash; late save refused |
| Lost HTTP acknowledgement after DB commit (response-dropping proxy) | ✅ data durable although client saw an error; retry returns `duplicate:true`, 1 journal row; lost *submit* ack replays the same receipt |
| PostgreSQL crash (`pg_ctl stop -m immediate`, then WAL recovery) | ✅ 0 acknowledged answers lost; API reported `db:false` while down (never "healthy"); **recovered without an API restart** |
| Redis FLUSHALL then hard outage | ❌→✅ **defect found and fixed** (below); afterwards login+start 347 ms, fleet 0 failures, submit 15 ms, health `redis:false` honestly |
| Duplicate request · out-of-order revision · two-tab conflict · submit racing a save | ✅ already covered by `exam-engine.test.ts` (idempotent replay; concurrent out-of-order converges on highest; SESSION_SUPERSEDED; race ⇒ included or rejected, never "saved but missing") |
| Client clock manipulation | ✅ API: forged `Date`/`X-Client-Time` headers and body fields (`deadlineAt`, `clientTime`, `serverNow`) ignored; deadline passes in DB ⇒ 409 TIME_EXPIRED and server auto-seals. Browser: device clock 6 h fast ⇒ countdown still ≈45:00 and DB deadline = server start + 45 min (Playwright) |
**Defect found: Redis outage made the API effectively unusable.** "Fail open" was implemented as slow failure: ioredis retried each command for 0.5–2 s (growing) and a login/save makes several Redis calls, so requests exceeded client timeouts; additionally the post-submit BullMQ enqueue waits forever while Redis is down, so *submit* would hang. **Fix:** Redis client with no offline queue, 500 ms command timeout and a 3 s circuit breaker (`RedisService.available`); grade-job enqueue is skipped/time-boxed (sweeper recovers grading). Regression test: scenario E.
**What this does NOT prove:** power loss / OS crash / disk fault (the "crash" is a PostgreSQL immediate stop on the same host; storage was the sandbox filesystem); replica failover/split-brain; multi-API-process interleavings; network partitions beyond a reset connection; behaviour under the 5,000-candidate load; PgBouncer. Password-reset tokens still live only in Redis (`auth.service.ts`) — recovery flow is unavailable during a Redis outage (exam path unaffected).
**Not in CI yet:** the suite needs PostgreSQL server binaries + `runuser` when run as root; add as a separate job once the CI workflow has been executed once.

### Checkpoint 5 — P0-C backup & restore
`scripts/db-backup.mjs` + `docs/operations/backup-restore.md`. **Accepted only after restoration was tested in isolation:** verified on the synthetic dev database and, in the fault suite, on a backup taken *during live candidate writes* (consistent snapshot) — restored into a disposable cluster, every one of 35 tables matched on count and content fingerprint, migrations and integrity triggers matched, the API booted on the restored copy with an intact audit hash chain and sealed receipt; a corrupted dump and a tampered manifest are rejected. Defect found while building it: my first audit-append-only probe queried a nonexistent column and misreported the restore as bad (probe fixed to use `ctid` and to distinguish probe errors from real failures).
**Not done (blocking for any real deployment):** point-in-time recovery (WAL archiving), encryption of dumps, scheduling/retention/off-site copy, restore-time measurement at production size. RPO today = backup interval.

### Checkpoint 6 — P0-D security (part 1: config, authorization coverage, key confidentiality, dependencies)
- **Production configuration validation** (`productionProblems` in `config.ts`, 18 tests): refuses to boot when secrets look like dev/example values or have low entropy or are identical; `WEB_ORIGIN` not https/localhost; DB URL without password / with the dev password / without `sslmode=require`; Redis without auth; dev MinIO keys; `TRUST_PROXY` not set behind a proxy; `SESSION_TTL_HOURS > 24`; `DEV_EXPOSE_CODES`. All violations reported at once, no secret values echoed. Named escape hatches (`DB_ALLOW_PLAINTEXT`, `REDIS_ALLOW_NOAUTH`, `ALLOW_NO_PROXY`) for private networks. Found while doing this: the compose `app` profile ran with the image's `NODE_ENV=production` and dev secrets — it would now rightly refuse; the compose file now sets `NODE_ENV=development` explicitly.
- **Authorization coverage guard** (`route-inventory.test.ts`): every one of the 92 routes must be `@Public` or have a `@Perm` that exists in the matrix (4 reviewed self-service routes may rely on authentication alone); the unauthenticated surface is pinned to exactly 6 routes; `docs/route-permissions.md` is generated and a new/changed route fails the build until regenerated and reviewed. *Limit:* this proves classification, not that each handler applies campus/course scope — that still depends on the per-feature tests.
- **Answer-key confidentiality** (`key-confidentiality.test.ts`): every GET route a student's role may reach is swept (ids substituted) during the sitting and after submission for `correctLabel/isCorrect/correct/answerKey` fields — none; plus start and submit payloads; unassigned lecturer/invigilator/campus admin get no keys from the paper endpoint. *Limit:* keys remain plaintext in PostgreSQL (`exam_questions.correctLabel`/`snapshot`); anyone with DB read access or a backup sees them — column-level protection/envelope encryption is **not** implemented (policy P-27).
- **Dependencies:** 17 → 11 advisories (0 critical/high); see `docs/security-triage.md` (fastify, nodemailer, vitest upgraded; remaining 11 moderate are dev lint tooling).
- **Rate limiting (decision recorded, unchanged):** login/OTP counters live in Redis and **fail open** during a Redis outage (otherwise nobody could sign in); brute force remains bounded by the database-backed account lockout (5 failures/15 min). IP-level limiting is therefore absent during a Redis outage.
**Still open in P0-D:** MFA for staff (next), staff session hardening (idle timeout, concurrent-session policy), CSP for the web app, DB-level key protection, Origin-header requirement on mutations.

### Checkpoint 7 — P0-D (2) staff multi-factor authentication (TOTP)
**Gap (from the audit):** no second factor for CCE / Super Admin / Examiner / Campus Admin, who can schedule exams, approve papers, publish results and see keys.
**Built:** RFC 6238 TOTP in `node:crypto` (no new dependency; verified against the RFC 4226 and RFC 6238 published vectors) · seeds encrypted at rest with AES-256-GCM (`MFA_KEY`; derived from `COOKIE_SECRET` only outside production) · per-session `mfaVerifiedAt`; the global guard returns 403 `MFA_REQUIRED` for **every** route except `me`/`logout`/the MFA endpoints while a session is `pending` (enrolled, not verified) or `enroll` (role requires MFA, none set up) · replay protection (code step must exceed the stored last step, compare-and-set so two concurrent requests with the same code cannot both succeed) · ±1 step clock tolerance · wrong codes share the 5-failure/15-minute lockout · 10 single-use recovery codes stored as SHA-256 · enabling signs out every other session · required roles cannot self-disable · Super Admin reset (lost device) revokes all sessions · all events audited (`mfa.setup_started/enabled/verified/verify_failed/recovery_used/disabled/reset`). `MFA_ENFORCE=true` and `MFA_KEY` are mandatory in production (config validation). Lecturers/invigilators/students: optional opt-in (profile → *Set up two-factor authentication*); students are not offered it.
**Tests:** `mfa.test.ts` (10: RFC vectors, drift/replay window, secret-box tamper, enrol-only access for an unenrolled CCE across 6 endpoints, enrol flow with revocation of other sessions, pending→verify, replay across sessions, lockout, recovery code once-only + hashed storage + audit, required-role cannot disable, SA reset signs out, opt-in/opt-out) + Playwright (opt-in enrol with wrong then right code, recovery codes shown, fresh browser forced to `/mfa`, URL bypass impossible, wrong code refused, next-step code accepted).
**Not done / caveats:** the *forced* `enroll` screen is exercised via the same component only through the opt-in path in the browser (the enforced state is API-tested, since Playwright runs with enforcement off); no WebAuthn/FIDO2 or SMS; no "trusted device" memory (every session needs a code); no idle-timeout/absolute re-auth for sensitive actions; recovery-code regeneration UI not built; MFA reset requires a Super Administrator who can themselves still sign in (break-glass procedure for the last Super Admin is undefined — policy P-29).

### Checkpoint 8 — P0-E observability
**Before:** only `GET /health` and Nest logs — nothing measured save success/failure/latency, submissions, DB failures, campus connectivity, auth failures or unauthorized requests.
**Built:** dependency-free Prometheus registry (`infra/metrics.service.ts`), `GET /api/metrics` (disabled unless `METRICS_TOKEN`; bearer token; mandatory in production config), HTTP middleware hook (route *patterns* only), save/submit instrumentation in the delivery controller, error-filter hooks (401/403 counters, unhandled and DB-error classification), auth/MFA failure counters, scrape-time DB/Redis probes, event-loop lag, and **per-campus connected/disconnected candidates** from the heartbeat hash (15 s cache; not emitted when Redis is down). `infra/observability/alerts.yml` — 14 rules; `docs/operations/observability.md` — metric catalogue, scrape config, runbook per alert.
**Tests (`metrics.test.ts`, 8):** scrape auth (401/401/200) and content type; counts for ok/duplicate/stale/superseded/expired saves with latency observations; a simulated database failure during a save is a 500, increments `error` + `db_errors`, is never reported saved, and the retry succeeds; submit ok/replayed/error; failed-login/lockout/401/403 counters; no ids in labels; campus A disconnected vs campus B connected (backdated heartbeat) and client-reported offline; DB-down probe flips `oes_db_up`; every metric named in an alert exists and every alert has severity, summary and an existing runbook anchor.
**Not done / honest limits:** alerts were **validated structurally, never evaluated by a real Prometheus/Alertmanager** (not available here); no routing/paging config, dashboards, log aggregation, tracing or external uptime probe; multi-instance aggregation is by convention (`sum()`), untested; the campus gauge reads every in-progress attempt every 15 s — at 20,000 candidates that query and the `HGETALL` of heartbeats need measuring (could be moved to a materialised counter); counters reset on restart (use `increase()`/`rate()`).

### Checkpoint 9 — P0-F load validation (measured; one shared 4-vCPU/16 GB sandbox)
Setup: dev PostgreSQL 16 (stock config: 128 MB shared_buffers, max_connections 100) + Redis + API processes (`DB_POOL_MAX` 20 each) + the load generator **all on the same 4 vCPUs**; synthetic candidates × 50 questions, ≈3 s think time, 15 % change-of-mind; every acknowledged answer verified in PostgreSQL afterwards. Workload now includes the admission gate and enrolment rows, metrics and the Redis circuit breaker.
| Run | start p50 / p95 / p99 | save p50 / p95 / p99 | heartbeat p95 | submit p50 / p95 | HTTP errors seen by client | integrity |
|---|---|---|---|---|---|---|
| Previous (1 API, 2,000) | 153 / 1886 / – ms | 6.4 / 137 / 246 ms | 133 ms | 181 / 322 ms | 0 | PASS (100,000 acks) |
| **R1** 1 API, 2,000 | 724 / 4163 / 4220 ms | 6.4 / 214 / 557 ms | 209 ms | 201 / 468 ms | 0 | PASS (100,000 acks, 0 missing/wrong/unsealed) |
| R2 3 APIs, 5,000 | 6346 / 22113 / 23598 ms | *(report lost — driver crashed on `Math.max(...)`; fixed in `f7b43fe`)* | – | – | **63 submit 500s** (server log) | not computed |
| **R3** 3 APIs, 5,000 (rerun) | 451 / 14363 / 15674 ms (max 18.6 s) | 712 / 1368 / 2998 ms (max 6.4 s) | 1327 ms | 773 / 2518 ms | 0 | **PASS (250,000 acks, 0 missing/wrong/unsealed, 0 receipt mismatches)** |
R3 host CPU: mean 89 %, peak 96 %, 9 of 55 samples ≥ 95 % — the box was saturated; the API processes alone used ≈ 180 % of 400 %.
**What this shows:** (1) *No acknowledged answer was lost or altered at 5,000 simultaneous candidates* (250,000 verified writes) — durability holds under load. (2) **Latency does not meet any reasonable SLO at 5,000 on this hardware**: save p95 1.4 s / p99 3.0 s, start p95 14 s. The 5,000 target is therefore **not demonstrated as acceptable**; it is demonstrated as *correct but slow* on a saturated shared box. (3) **Regression vs the previous 2,000-candidate run** (start p95 1.9 s → 4.2 s, save p99 246 → 557 ms) — cause **not isolated** (candidates: admission queries added to `start`, metrics, larger dev DB holding earlier runs, run-to-run variance). Needs an A/B, not a guess.
**Unexplained / to investigate:** R2 and R3 were the same configuration yet start p50 differed 6.3 s vs 0.45 s — large run-to-run variance; R2's 63 `Unable to start a transaction in the given time` errors (Prisma interactive-transaction wait for a pool connection during the submit wave, all at 22:28:19–20) did **not** recur in R3 but show the submit path can 500 near saturation — candidates retry idempotently, yet this must be fixed (shorter transaction, larger/queued pool, PgBouncer). Server-side counters in R3's summary line are cumulative across R2+R3 (API processes were not restarted); only the client-side table and the log timestamps attribute errors to a run.
**Not tested / not claimed:** 10,000 or 20,000 candidates; dedicated hardware or separate hosts for DB/API/generator; tuned PostgreSQL; PgBouncer; real network latency/campus links; login storm (sessions were pre-provisioned, argon2 not exercised); the lifecycle sweeper under load (`RUN_WORKERS` on one process only); monitor/dashboard polling load. **No pilot-readiness claim is made.** Suggested next: A/B the `start` path (with/without admission queries) on a clean DB; 1 vs 3 processes on separate hosts; PostgreSQL tuning + PgBouncer; then re-run 5,000 with SLOs agreed first (e.g. save p99 < 500 ms, start p95 < 3 s).

### Checkpoint 10 — start-path A/B, submit-transaction fix, all-questions view
- **Submit transaction** (`47997bc`): `finalize()` no longer holds a Prisma interactive transaction open across pool waits (it 500'd with "Unable to start a transaction in the given time" under a 3-connection pool: 14×500 before, 0 after; `submit-contention.test.ts`). **Not re-measured under the 5,000-candidate load.**
- **Start-path A/B** (`d85e3a3`, 3 alternating rounds, N = 2,000, start-only, fresh disposable cluster each): admission lookup on → p50 43 ms / p95 618 ms (456–625); stubbed → p50 23 ms / p95 388 ms (359–419). The lookup costs ≈ +20 ms p50 / +230 ms p95; it does **not** explain the 724 ms p50 / 4.2 s p95 of the full 2,000 run, which appears when starts coincide with saves and heartbeats. Cause of that regression is not isolated.
- **All questions on one page** (`5b87741`): optional layout in the exam player (same engine and save path); browser spec covers answer, skip, mark, palette jump, reload, review, submit.

### Checkpoint 11 — Phase 21 build stabilization (details: `docs/audit/stabilization/`)
Fixed and verified (TODAY): campus-scoped `GET /reports/institutions` (root cause: handler took no caller; Campus Admin received every campus) and campus-scoped exam detail/list (found by a new structural sweep); `npm run lint` exit 0; fault harness exit code (declared-outage error policy, deterministic teardown; an unexpected error still fails the run); Playwright state leak (MFA spec has its own account + admin-endpoint teardown; every state-changing spec owns its candidate; browser seed = 8 students/campus); Content-Security-Policy with per-request nonce (production: no `unsafe-inline`/`unsafe-eval` for scripts; one documented relaxation, `style-src-attr`); `node:crypto` removed from the browser bundle (client chunk 457,695 → 234,821 bytes) with a guard test; 11 dead notification links replaced by one shared definition and the bell now navigates; branded 404, route/global error boundaries, forbidden/offline/unavailable/expired-session states; favicon (cropped from the approved logo, pixels unchanged).
No database change; the shared development database was not touched (12,023 users before and after) and a verified backup of it was taken.
**Classification after this phase: INTERNAL_TESTING_READY (unchanged).** Remaining blockers are unchanged: exam control operations, Redis-dependent lifecycle sweeper, polling monitor, scale evidence beyond 2,000, operations (backups/alerts/CI/deploy). See `docs/audit/stabilization/07-remaining-risks.md`. No pilot-readiness claim.

### Checkpoint 12 — Live exam control (details: `docs/audit/live-exam-control/`)
**Built (backend-driven, one engine):** exam state machine extended in place (`ADMISSION_OPEN`, `SUSPENDED`, `CLOSING`, `SCORING`; `LIVE`/`RESULT_PENDING`/`PUBLISHED` keep their names); nine permission-protected, transactional, idempotent, audited commands (open/close admission, start, suspend, resume, extend with preview, close/force-close, reconcile, initiate scoring) plus a policy command; per-exam `timingPolicy` (INDIVIDUAL/SYNCHRONIZED with lobby), `controlMode` and `suspendTimePolicy` (undecided by default → suspension refused until approved, **P-30**); suspension enforced in the save SQL predicate, submit and start; **PostgreSQL-driven lifecycle reconciler** (database lease, idempotent steps, backlog recovery, bounded retries, metrics) replacing the Redis/BullMQ sweeper; transactional outbox (`exam_events`) + Redis publish + database catch-up, SSE with cursor replay, campus/candidate scoping; bounded monitoring (one shared aggregate per exam per process, paged candidates); control centre `/exams/:id/control`, campus monitor on SSE, candidate player reacting to suspend/resume/extend/close.
**Verified (TODAY):** typecheck, lint, build exit 0; shared 25/25; API 237/237; Playwright 33/33 ×2; fault suite 17 passed (exit 0), including Redis killed mid-exam (saving continues, expired attempt sealed exactly once by the PostgreSQL reconciler, events reach SSE from the database, outbox drains on return), API SIGKILL with backlog, two workers with leader failover.
**Bugs found and fixed on the way:** outbox `eventId` null in raw insert; `ADMISSION_CLOSED` reported as `NOT_AVAILABLE`; override/cancel/exam-list/duties ignoring new states; key-sweep hanging on SSE routes; a refused save diagnosed after a resume was reported `TIME_EXPIRED` (found under load, now a retryable `STATE_CHANGED`; 19 occurrences, 0 false expiries in the final control run); synchronized drill leaving a stray open exam for other specs.
**Performance (2,000 candidates, one shared 4-vCPU box, 8 valid runs):** integrity PASS in every run; the new code is indistinguishable from the pre-feature commit in the same environment (start p50 1.8–2.5 s old vs 2.5–4.2 s new, within the box's ± 50 % variance); the gap to the historical 0.7 s start p50 is environmental (the *old* commit shows it too, cause not isolated); workers on add submit-wave load (submit p50 ≈ 200–310 ms vs ≈ 15 ms — attribution to concurrent grading unproven); 16 SSE viewers + dashboard polling + exam-wide extend/suspend/resume under load showed no effect outside run-to-run noise and the shared aggregate ran ≈ once per 2.3 s (mean 166 ms) regardless of viewers; exam-wide commands on ≈ 1,000–1,500 live attempts took 0.6–2.6 s. **Four earlier runs were discarded** (a restart step had silently failed, so they shared one API process). Not measured: 5,000+, several API processes, real proxy, many viewers.
**Database:** two additive migrations (`exam_live_control`, `exam_force_close`); the shared development database was **not** migrated at that checkpoint (12,023 users, 6 migrations) — see checkpoint 13 for what happened to its data afterwards.
**Not done / not claimed:** no capacity at scale, no real examination run, no accessibility audit of the control centre, answer keys still plaintext (P-27), limiter fail-open (P-28). Classification unchanged: **INTERNAL_TESTING_READY**; the previously blocking gaps "no exam control", "lifecycle depends on Redis" and "monitor polls an unbounded query" are now addressed and tested at 2,000-candidate scale, but scale evidence, operations (backup/alerts/CI/deploy) and policy approvals (P-30) remain.

### Checkpoint 13 — Scale-risk pass before the 5,000-candidate test
**Changed:** set-based SQL for exam-wide suspend/resume/extend (incl. notifications); post-commit reconcile kicks run in the background; lifecycle runs renew their lease, scoped runs wait for an in-flight pass (`idle()`); in-process save limiter (`LocalRateWindow`, 2 tests); adaptive monitor cache TTL; bulk seals skip per-attempt grade enqueue; `LIFECYCLE_CONCURRENCY`, `SSE_MAX_PER_USER/PROCESS` knobs; targeted benchmark `tests/load/scale-bench.mjs`.
**Verified (TODAY):** lint and typecheck exit 0; API **239/239** (17 files); fault suite **17 passed, 1 skipped, exit 0**. **Playwright was NOT re-run successfully this checkpoint** (see below).
**Measured (single runs, one API process, shared 4-vCPU box):** group commands ≈ 3× faster; save stalls during commands removed (max 3.7 s → 68 ms at 20,000); mass expiry unchanged at ≈ 250–330 seals/s; heartbeat ≈ 870–920/s per process. Details and negative findings: `docs/audit/live-exam-control/10-performance-results.md`.
**Incident (mine):** running `npx playwright test` executes `tests/e2e/global-setup.ts`, which runs `seed --reset` against the **shared development database (:5433)**. That database was still at 6 migrations, so the seed failed after the reset: the dev DB now holds **27 users (was 12,023)** — all synthetic, a backup from checkpoint 11 exists. Applying the pending migrations was not performed (denied by the permission layer). Playwright must run against a disposable database or after the dev DB is migrated and reseeded with owner approval.
**Not claimed:** capacity at 5,000 or 20,000; pilot readiness. Classification unchanged: **INTERNAL_TESTING_READY**.
