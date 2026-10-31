# 01 — Executive summary (current build audit)

_Audit date 2026-10-31 · branch `claude/oes-platform-foundation` · HEAD `d85e3a3` (= origin) · working tree clean at start. No application source was modified by this audit; the only files written are under `docs/audit/current-build-analysis/` (uncommitted, per the audit rules)._

Evidence labels used throughout: **TODAY** = executed during this audit; **EARLIER-TODAY** = measured earlier in the same working day, not re-run by this audit; **HISTORICAL** = recorded in `docs/implementation-status.md` or earlier sessions, not re-verified; **SOURCE** = read from code only; **NOT RUN**.

## Verdict

| | |
|---|---|
| **Current stage** | **Stage 4 — working end-to-end examination path** (late). Stage 5 ("integrated platform undergoing stabilization") is *not* earned: operator controls, operational readiness and scale evidence are missing (see below). The earlier Stage-5 label is not inherited. |
| **Classification** | **INTERNAL_TESTING_READY** |
| Not claimed | controlled pilot, supervised institutional use, production readiness, 20,000-candidate capacity |

## What is demonstrably strong (TODAY unless stated)

- Build, typecheck (shared/api/web) and production Next build succeed. 15 shared + **171/171 API integration tests** pass against real PostgreSQL 16 + Redis.
- **Answer durability**: atomic revisioned saves, DB-clock deadlines, idempotent HMAC-receipted submit; fault suite (DB crash/WAL recovery, Redis outage/flush, API kill, lost responses, multi-API) passes its 10 assertions (see caveat on exit code). 5,000-candidate load: 250,000 acknowledged answers, 0 lost/altered (HISTORICAL, `implementation-status.md` ckpt 9).
- **Authorization**: deny-by-default route manifest (98 routes, 7 explicitly PUBLIC: login, forgot, reset, verify-code, health, public/verify, metrics), campus scoping, lecturer↔course assignments, separation of duties; live cross-campus probes on individual records returned 403/404, **except** `GET /api/reports/institutions`, which lets a Campus Admin list every campus with student/user counts (MEDIUM, `D-09`; TODAY).
- **Backup/restore** verified by isolated restore (3 tests pass TODAY).

## What blocks anything beyond internal testing

1. **No operator control over a live exam** beyond per-candidate +1–60 min and force-submit. No suspend/resume, open/close admission, exam-wide extension, or "initiate scoring" — all return 404 (TODAY probe). Lifecycle is purely clock-driven.
2. **Lifecycle correctness depends on one Redis/BullMQ sweeper** (`jobs.service.ts:21-22`, `results.service.ts:54`): auto-submit, LIVE/CLOSED, absentee marking and RESULT_PENDING all happen there; never fault-tested.
3. **Scale is unproven**: 2,000 and 5,000 are *correct but slow* on one shared 4-vCPU box (5,000: save p99 3.0 s, start p95 14 s); 10,000/20,000 never run.
4. **Live monitor is 5-second polling over an unbounded per-exam query** (`invigilation.service.ts:39-60`), never load-tested; no SSE/WebSocket.
5. **Operations**: backups are a manual script (no schedule/PITR/encryption/off-site); alert rules never fired against a real Prometheus; no CI run of the workflow/compose; no deployment path exercised.
6. **Domain gaps**: no question images/attachments, no exam-day attendance/room/seat model, no formal post-publication correction workflow, no server-side PDF.

## Things found wrong today (all recorded in `16-defect-register.md`)

- `npm run lint` **fails** (6 errors in `apps/api/test-fault/bench-main.cjs`, my last commit).
- Playwright **16/17**, not 17/17 as `implementation-status.md` claims: the MFA spec leaves `invigilator.b` enrolled, so the later invigilator spec is redirected to `/mfa`. Product behaviour is correct; the suite is order-dependent.
- `npm run test:fault` **exits 1** though all assertions pass: an unhandled `pg` pool error from the harness's own pool when the test crashes the DB on purpose.
- Mobile/tablet: the sidebar stacks above content, pushing the page body ~420 px (390 px wide) to ~570 px (768 px wide) down the viewport; the 390 px exam palette is below the fold.
- No error/not-found/loading boundaries in the web app; every page logs a `favicon.ico` 404; six notification deep-links point to routes that do not exist.

## Direct answer to "where does it stand?"

A well-tested, durable exam-delivery core with solid access control, sitting inside an incomplete operating envelope. It is suitable for **internal testing with synthetic data**. Before a controlled pilot the minimum set is: exam-control operations (suspend/resume/extend-all/close), sweeper resilience tests, monitor redesign + load test, scheduled/off-site/encrypted backups with a rehearsed restore, alerts proven against Prometheus, a repeatable green CI, and mobile layout fixes. See `18-prioritized-roadmap.md` and `19-next-development-prompt.md`.

## Final verdict (Phase 20)

CURRENT PROJECT STAGE: Stage 4 (late) · BUILD STATUS: build/typecheck/tests green; **lint red, fault-suite exit red, Playwright 16/17** · FUNCTIONAL READINESS: exam delivery, authoring, grading and publication work; exam control, scalable monitoring and several domain features missing · SECURITY READINESS: no CRITICAL/HIGH in exercised paths; 1 verified MEDIUM isolation disclosure; no CSP; plaintext keys; no pen-test · PERFORMANCE EVIDENCE: 2,000 measured, 5,000 correct-but-slow, 10,000/20,000 untested · EXAMINATION INTEGRITY: strong (0 lost/altered answers across 100 k and 250 k verified writes; fault suite) · CRITICAL BLOCKERS: D-01, D-02, D-03, D-04, D-05 · RECOMMENDED NEXT PHASE: `18` Phases 0–1 (`19` prompt) · **Final classification: INTERNAL_TESTING_READY**.

| # | Question | Answer |
|---|---|---|
| 1 | Builds? | Yes (build/typecheck exit 0); lint exits 1 |
| 2 | Frontend works? | Yes for exercised flows; mobile shell and error boundaries deficient |
| 3 | Backend works? | Yes; 171/171 tests |
| 4 | PostgreSQL integrated? | Yes, strongly (CTE saves, triggers, hash chain, verified restore) |
| 5 | Engine fully functional? | Core yes; no pause/resume, no images |
| 6 | Skip MCQ? | Yes (e2e + engine tests) |
| 7 | Question sidebar? | Yes (desktop verified; below the fold on phones) |
| 8 | Answers reliably saved? | Yes, within tested faults and scale |
| 9 | Timer server-controlled? | Yes |
| 10 | Examiner can schedule? | Yes (API verified; no browser spec) |
| 11 | Thousands join at once? | 2,000 measured; 5,000 slow; beyond untested |
| 12 | Real-time monitoring operational? | Polling snapshot only; not load-tested |
| 13 | Suspend/resume? | **No** |
| 14 | Campuses isolated? | Records yes; one MEDIUM aggregate leak (D-09) |
| 15 | Campus admins see authorized results? | Published-only enforced (probes); browser view of published data not tested |
| 16 | Automatic grading? | Yes |
| 17 | Approved and published correctly? | Yes (API workflow tests) |
| 18 | All roles operational? | 7 of 8 expected roles exist; no Institution Administrator; Examiner/CCE control UI limited |
| 19 | Incomplete | `15` rows NI/PW |
| 20 | Top-10 defects | D-01…D-05, D-09, D-06, D-07, D-08, D-11 |
| 21 | Stage | 4 |
| 22 | Internal pilot testing? | Internal *testing* with synthetic data: yes |
| 23 | Preventing supervised use | exam control, sweeper resilience, monitor scale, operations, scale evidence |
| 24 | Next | `19-next-development-prompt.md` |
