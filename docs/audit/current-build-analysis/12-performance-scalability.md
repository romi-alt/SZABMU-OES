# 12 — Performance and scalability

No new large load test was launched by this audit (instruction). All figures are HISTORICAL/EARLIER-TODAY, taken on **one shared 4-vCPU / 16 GB sandbox running the API process(es), PostgreSQL (stock config: 128 MB shared_buffers, max_connections 100), Redis and the load generator together**; synthetic candidates × 50 questions, ≈3 s think time; every acknowledged answer verified in PostgreSQL afterwards. Source: `docs/implementation-status.md` (load tables, ckpt 9), `/tmp/load-r{1,2,3}.out`.

| Candidates / APIs | start p50 / p95 / p99 | save p50 / p95 / p99 | heartbeat p95 | submit p50 / p95 | Errors | Integrity | Host CPU |
|---|---|---|---|---|---|---|---|
| 2,000 / 1 (prior optimised run) | 153 / 1,886 ms | 6.4 / 137 / 246 ms | 133 ms | 181 / 322 ms | 0 | PASS 100,000 | n/a |
| 2,000 / 1 (R1, with admission/enrolment/metrics) | 724 / 4,163 / 4,220 ms | 6.4 / 214 / 557 ms | 209 ms | 201 / 468 ms | 0 | PASS 100,000 | mean 52 %, peak 64 % |
| 5,000 / 3 (R2) | 6,346 / 22,113 / 23,598 ms | report lost (driver crash, fixed) | – | – | 63 submit 500s (server log) | not computed | – |
| 5,000 / 3 (R3 rerun) | 451 / 14,363 / 15,674 ms (max 18.6 s) | 712 / 1,368 / 2,998 ms | 1,327 ms | 773 / 2,518 ms | 0 | **PASS 250,000** | mean 89 %, peak 96 % |
| 10,000 · 20,000 | **not run** | | | | | | |

## What the evidence supports

- **Measured**: durability under load at 2,000 and 5,000 (0 lost/altered answers); latency at 2,000 is plausible for a pilot-scale session; at 5,000 on this box the system is **correct but slow** and the box was saturated (89 % mean CPU).
- **Not measured / extrapolated risk only**: 10,000 and 20,000; dedicated DB host; tuned PostgreSQL; PgBouncer; real network; login storm (sessions were pre-provisioned, argon2 not exercised); the lifecycle sweeper under load; monitor polling load; submit wave after the `47997bc` fix.
- **Run-to-run variance is large**: R2 vs R3 (same configuration) start p50 6.3 s vs 0.45 s. One run is not a benchmark.
- **A/B of the start path (EARLIER-TODAY, 3 alternating rounds, N=2,000, start-only, 20 s ramp, fresh disposable cluster each round)**: admission on — p50 43 ms, p95 618 ms (456–625), p99 651 ms; admission stubbed — p50 23 ms, p95 388 ms (359–419), p99 461 ms. Start in isolation is cheap; the admission lookup adds ≈ 20 ms p50 / ≈ 230 ms p95. The 724 ms p50 / 4.2 s p95 seen in the full 2,000 run is therefore **not** explained by the admission query; it appears when starts coincide with saves/heartbeats (and an under-provisioned pool). No bottleneck is attributed to Node, PostgreSQL or Redis; no profile was taken.

## Known cost drivers from source (not proven bottlenecks)

- `monitor()` per poll: all candidates + attempts + full-exam `GROUP BY` over `attempt_answers` (`invigilation.service.ts:41-48`), per viewer, every 5 s.
- `answer_events` ≈ 1 row/save; ≈ 1 M rows per 20,000 × 50 questions; unpartitioned.
- Submit wave: pool contention was the 500 source; `finalize` now minimises the transaction (`47997bc`) — verified only by the 3-connection contention test.
- `tick`: sequential finalise/grade of ≤500 per 10 s.
- Pool size per API process 20 (`DB_POOL_MAX`) against `max_connections=100`: three APIs ≈ 60 connections + workers.

## Capacity statement

| Target | Status |
|---|---|
| 2,000 simultaneous | **Measured**, integrity PASS, latency acceptable only on the unrealistic assumption that a dedicated box is not needed; re-verify on target hardware |
| 5,000 simultaneous | **Measured correct, not acceptable latency** on the shared box |
| 10,000 | **Untested** |
| 20,000 | **Untested**; engineering target only |

## Prioritised recommendations

1. Re-run 2,000 and 5,000 on separate hosts (DB, API ×N, generator), tuned PostgreSQL, with `/api/metrics` + `pg_stat_statements` + `EXPLAIN` captured for the top statements; only then name a bottleneck.
2. Replace the monitor query with a bounded, campus-scoped, paginated read backed by a maintained counter (or Redis progress) and test it concurrently with a saving population.
3. Re-measure the submit wave after `47997bc` and the login storm (argon2).
4. Test the sweeper at scale (mass expiry, Redis restart).
5. Evaluate PgBouncer/pool sizing and journal partitioning on measured data.
