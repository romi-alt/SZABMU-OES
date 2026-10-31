# 18 — Prioritized roadmap

Ordered by risk to a real examination. Each step: build smallest change → regression test first → run full suite → update `docs/implementation-status.md` → separate commit. No step is "done" without frontend + backend + persistence + permission + test evidence.

## Phase 0 — Make the repo trustworthy (½ day)
1. Fix lint (D-10), un-couple the MFA e2e state (D-11a), add pool error handlers to the fault harness (D-11b). Run full suite twice; both must exit 0.
2. Fix D-09 (scope `/reports/institutions`) with the "campus-A across all list/aggregate routes" test.
3. Correct stale counters in `implementation-status.md` (D-19).

## Phase 1 — Exam control and lifecycle resilience (P1: D-01, D-02)
4. Design `SUSPENDED` state and deadline arithmetic (pause adds paused duration), exam-wide/campus/selected-candidate extension, open/close admission, manual "initiate scoring" — each audited with reason, idempotent, role-checked (CCE/Super Admin; campus-scoped for invigilators), reflected in heartbeats and the player.
5. Make the lifecycle tick DB-driven (advisory-lock leader) with Redis only as an accelerator; batch/parallel finalise; staleness metric + alert.
6. Fault tests: Redis down at deadline, worker killed mid-tick, two workers, 5,000 mass expiry.
7. Browser specs: examiner creates → approves → schedules → monitors → suspends → resumes → closes → publishes.

## Phase 2 — Monitoring that scales (D-04)
8. Bounded, campus-scoped, paginated monitor read; maintained answered-count; optional SSE. Load test with monitors polling during a saving population.

## Phase 3 — Measure before optimising (D-03)
9. Separate hosts (DB / API ×N / generator), tuned PostgreSQL, `pg_stat_statements`; repeat 2,000 / 5,000 / 10,000; login storm; submit wave; record variance across ≥3 runs. Name bottlenecks only from profiles.

## Phase 4 — Operations (D-05, D-13)
10. Scheduled encrypted off-site backups + PITR; restore drill with timings; Prometheus/Alertmanager running and every alert fired once; structured logs + error reporting; CI green on a clean runner; deploy + rollback runbook exercised in a staging environment (no production).
11. Decide P-27 (key encryption) and P-28 (limiter fail mode).

## Phase 5 — Domain completeness (D-06, D-07, D-08, D-20)
12. Question images, exam-day attendance/rooms/seats, post-publication correction workflow, manual grading if required, server-side PDF/certificate.

## Phase 6 — UX & accessibility (D-12, D-14, D-15, D-17)
13. Responsive shell, mobile player palette, error boundaries, CSP, dead links/favicon, axe + keyboard/screen-reader pass, mobile Playwright projects.

## Gate to "controlled pilot candidate"
Phases 0–4 complete, 2,000-candidate rehearsal on target-like hardware green with monitor load, restore drill passed, security review closed, policy decisions P-26…P-29 signed off by the university.
