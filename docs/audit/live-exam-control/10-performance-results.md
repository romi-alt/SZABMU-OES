# 10 — Performance validation

**Scope: 2,000 synthetic candidates × 50 questions, one API process, on one shared 4-vCPU / 16 GB sandbox that also hosts PostgreSQL 16 (stock settings), Redis and the load generator.** No 20,000-candidate test was run: no approved staging environment exists and none was assumed. These numbers are **not** capacity claims.

Workload (unchanged `tests/load/exam-load.mjs`): 2,000 candidates ramp over 20 s, ≈3 s think time, 50 answers each, submit; every acknowledged answer is verified in PostgreSQL afterwards. New: `--exam-file` (publishes the exam id) and `tests/load/control-load.mjs` (16 SSE staff streams, dashboard polling every 2 s of the control view and a candidates page, and — in the control run — real exam-wide commands issued mid-load). Runs used a **fresh disposable PostgreSQL** and a **fresh API process each time** (verified: server-side counters equal each run's own traffic).

## Valid runs (TODAY)

| Run | Code | Workers | Viewers/commands | start p50 / p95 | save p50 / p95 / p99 | heartbeat p95 / p99 | submit p50 / p95 | host CPU mean | integrity |
|---|---|---|---|---|---|---|---|---|---|
| f | **old** (`07d61d9`, before this work) | off | – | 2,483 / 7,266 ms | 10.0 / 176 / 2,235 | 82 / 2,526 | 14.6 / 79 | 54 % | PASS |
| g | old | off | – | 1,844 / 5,984 | 11.4 / 256 / 1,408 | 135 / 1,477 | 16.2 / 74 | 56 % | PASS |
| a | new | off | – | 2,548 / 6,600 | 7.9 / 201 / 1,793 | 100 / 2,007 | 16.6 / 139 | 55 % | PASS |
| d | new | off | – | 4,194 / 6,729 | 10.1 / 189 / 1,860 | 89 / 2,057 | 17.0 / 82 | 56 % | PASS |
| h | new | off | – | 3,763 / 6,780 | 9.7 / 223 / 1,874 | 80 / 2,059 | 14.1 / 67 | 55 % | PASS |
| b | new | **on** | – | 5,248 / 8,073 | 14.7 / 224 / 2,480 | 156 / 2,331 | 197 / 432 | 59 % | PASS |
| e | new | on | – | 4,625 / 9,001 | 19.7 / 347 / 2,710 | 327 / 3,026 | 311 / 786 | 61 % | PASS |
| c | new | on | **16 viewers, polling, extend + suspend + resume** | 4,508 / 7,050 | 9.4 / 208 / 2,728 | 152 / 2,508 | 169 / 401 | 57 % | PASS (81,744 acknowledged answers verified; the suspension legitimately refused 5,222 saves; 19 saves racing the resume got the retryable `STATE_CHANGED`, none a false `TIME_EXPIRED`) |

Every run: 0 acknowledged answers lost or altered, 0 unsealed submits, 0 receipt mismatches.

### Discarded runs
Four earlier runs (n1–n4) are **not used**: my restart step failed silently, so they all hit one API process (server counters accumulated to 431,682 saves). That made the "workers off" run not workers-off. They are kept only as a record of run-to-run variance on this box (start p50 445–4,782 ms for identical configuration). The corrected runs above replaced them.

## What the evidence supports

1. **The control work does not change the existing exam path measurably.** Old commit vs new commit, same environment, workers off: start p50 1.8–2.5 s vs 2.5–4.2 s, save p99 1.4–2.2 s vs 1.8–1.9 s, heartbeat p99 1.5–2.5 s vs 2.0–2.1 s, submit p50 15–16 ms vs 14–17 ms. The ranges overlap; with n = 2–3 per side this box cannot resolve a difference smaller than its own variance (±~50 %).
2. **The gap to the historical 2,000-candidate result (start p50 0.72 s) is environmental, not this code**: the *old* commit shows the same 1.8–2.5 s here. Likely contributors (**not verified**): a brand-new un-analysed database cluster, cold paper cache/JIT on a fresh process, and sandbox noise. No profile was taken; no bottleneck is attributed to Node, PostgreSQL or Redis.
3. **Reconciler/workers on adds load during the submit wave**: submit p50 ≈ 200–310 ms (workers on) vs ≈ 15 ms (workers off), save p99 ≈ 2.5–2.7 s vs ≈ 1.8 s. This is consistent with grading (queue consumers and the reconciler's database backstop) now running *concurrently* with submissions — work that "workers off" runs simply never do — but that attribution is **not proven** (no old-commit run with workers on, no profile). Tuning knobs exist (batch 200, concurrency 8, interval 5 s, queue concurrency 16).
4. **Live monitoring cost is bounded and independent of viewer count.** In run c the shared aggregate was computed 97 times (mean 166 ms each) in a ≈ 4-minute run — about one computation per 2.3 s, although 16 SSE viewers, 78 snapshot requests and 78 candidate-page requests were all served; per-viewer data is an in-memory filter. 16 SSE streams delivered 637 frames (598 stats snapshots, 39 events). Dashboard polling under load: control view p50 29 ms / p95 1.1 s; candidates page p50 133 ms / p95 0.6 s; 0 poll errors. Saves and heartbeats in run c are inside the spread of runs b and e (workers on, no viewers).
5. **Exam-wide commands act on thousands of live attempts in about a second or two.** One transaction each, while ≈ 2,000 candidates were saving (run c, a single measurement of each): extend 2.4 s (1,021 attempts), suspend 2.6 s (1,500), resume 0.6 s (1,500). Candidate saves were refused with `EXAM_SUSPENDED` during the suspension (5,222) and nothing acknowledged was lost. The resume race that this load exposed in the discarded runs (two refused saves wrongly reported as `TIME_EXPIRED`, which would have made a candidate's screen think its time was up) is fixed: this run shows 19 retryable `STATE_CHANGED` and 0 `TIME_EXPIRED` at the resume moment. Event arrival at the viewers (measured from before the command was sent, so it includes the command itself): 0.4–1.6 s.
6. **Lease behaviour after a hard kill** (observed): the previous process's lease lingers up to 30 s, so a new process reported `skipped_not_leader` for its first passes before taking over — by design, and visible in the metrics.

## Not measured / not claimed

- 5,000, 10,000, 20,000 candidates; separate DB/API hosts; tuned PostgreSQL; PgBouncer; several API processes under load; a real reverse proxy in front of SSE.
- Many simultaneous controllers; thousands of SSE viewers (per-user cap is 4, so the test used 16 viewers over four staff accounts).
- The cost of the notification fan-out (one row per affected candidate) at scale.
- Statistical significance: single runs per configuration (two for old/new workers-off), on a noisy shared box.


## Scale-risk pass before the 5,000-candidate test (TODAY)

Tool: `tests/load/scale-bench.mjs` (targeted benchmark; seeds attempts directly with set-based SQL, so it measures the **control plane and save/heartbeat path, not login/start**). Environment: one shared 4-vCPU sandbox, disposable PostgreSQL + Redis, **one API process**, load generator on the same box. Single run per cell (no repeats) — treat differences under ~30 % as noise. Before = commit `f7133f9`; after = this change.

| | 5,000 before | 5,000 after | 20,000 before | 20,000 after |
|---|---|---|---|---|
| exam-wide extend / suspend / resume (ms) | 1348 / 1325 / 1552 | 503 / 550 / 471 | 5151 / 5144 / 5472 | 1699 / 1615 / 1731 |
| save p95 *during* a command (ms) | 896 / 34 / 806 | 53 / 49 / 27 | 215 / 142 / 3360 | 40 / 39 / 33 |
| save max during a command (ms) | 932 | 77 | 3718 | 68 |
| heartbeats/s (closed loop, 48 workers) | 890 | 923 | 859 | 870 |
| saves/s (no commands) | 1194 | 1223 | 1137 | 1164 |
| mass expiry, sealed/s | 246 | 242 | 327 | 330 |
| integrity (sealed = receipts = events) | pass | pass | pass | pass |

What changed and why: suspend/resume/extend moved their per-attempt work (20,000 ids, per-candidate notification inserts) from Node into single set-based SQL statements, which removed the event-loop stall that made concurrent saves wait (cause: CPU profile, `--cpu-prof`). Group commands are ≈ 3× faster and save latency during them is back to baseline. The per-save abuse limiter no longer makes a Redis round trip (in-process window, ≈ 5 % of profile).

**Not improved / negative findings**
- Mass expiry is **~245–330 seals/s and did not change** with either "bulk seals skip the per-attempt grade enqueue" or `LIFECYCLE_CONCURRENCY` 8 vs 16 (5,000: 249/s at 8, 242/s at 16, 246/s baseline). The bottleneck is not the enqueue or the worker pool width; it is not yet attributed. Expect ≈ 20 s per 5,000 and ≈ 60 s per 20,000 expiring in the same instant, on this box.
- A single API process saturates around 700–900 heartbeat/save requests/s; the profile is dominated by socket writes and Redis/PostgreSQL round trips, not by application code. Reaching 5,000 candidates therefore needs more than one API process (and the load generator on a different host); no capacity figure is claimed.
- **Unexplained regression:** `candidates` page p50 rose from 17 → 71 ms (5,000, idle) and 50 → 121 ms (20,000). It appears at idle, so it is not write contention. Not investigated further (possible planner statistics after seeding, or the changed monitor cache TTL); needs an `EXPLAIN` before the test.
- Session lookup still costs one Redis GET per request (≈ 4.6 s of profile). Caching it in-process would delay session revocation, so it was **left as is pending a decision**.
