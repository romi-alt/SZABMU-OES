# 09 — Performance Readiness

## Measured (previous session, `tests/load/exam-load.mjs`; not re-run today)
Environment: one 4-vCPU box shared by API, PG 16, Redis and the load generator; 2,000 synthetic candidates × 50 questions; ramp 20 s; ≈3 s think time; Node 26; API single process; 512 max connections.

| Run | start p50/p95 | save p50/p95/p99 | heartbeat p95 | submit p50/p95 | errors |
|---|---|---|---|---|---|
| Before optimisation | 6245/8642 ms | 9.7/741/2927 ms | 1879 ms | 1238/2188 ms | 0 |
| After optimisation | 153/1886 ms | 6.4/137/246 ms | 133 ms | 181/322 ms | 0 |

Both runs: 100,000 acknowledged answers, 0 missing, 0 wrong, 0 unsealed submits, 0 receipt mismatches (verified by direct SQL).

## Scenario readiness
| Scenario | Status | Reasoning |
|---|---|---|
| 100+ campuses | architecture OK (scoping is query-level); load by campus not tested | I |
| 2,000 concurrent | MEASURED, passes on dev hardware, start storm p95 1.9 s | V |
| 5,000 | NOT TESTED | extrapolation unsafe: the box was already CPU-shared |
| 10,000 / 20,000 | NOT TESTED | **no claim of readiness** |

## Expected bottlenecks (estimates, unmeasured)
1. Thundering-herd `start` at exam open: argon2 not involved, but login storm is (argon2id CPU cost) — login of 20k candidates in minutes needs sizing/queueing or staggered windows.
2. PG connection count: need PgBouncer; Prisma pool per API process × N processes.
3. `answer_events` insert volume (≈ one row per save) and index maintenance; partition.
4. Single Redis (paper cache, sessions, heartbeats, rate limit) — SPOF.
5. Monitor polling over large rosters; needs aggregate SQL/materialised counters.
6. Result grading burst at close (BullMQ in same process).
7. Web bundle size not measured (no `next build` size analysis recorded).

## Recommended order
(1) multi-process API + PgBouncer on a dedicated load environment; (2) 5k run with p95 SLOs written down first; (3) login-storm test; (4) partition `answer_events`; (5) fault-injection under load (kill API, restart PG, flush Redis); (6) 10k, then 20k only on production-like infrastructure with sign-off.

Dependencies: Docker host/Kubernetes, separate load-generator hosts, PgBouncer, Redis persistence/HA.
