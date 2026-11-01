# 03 — Lint, fault harness and shared-package fixes

## Lint (`apps/api/test-fault/bench-main.cjs`)

| | Before (`npm run lint`, exit 1) | After (exit 0) |
|---|---|---|
| Errors | 6× `no-undef`: `4:23 require`, `5:24 require`, `6:29 require`, `7:5 process`, `12:139 console`, `12:157 process` | none |
| Cause | a CommonJS file linted without Node globals | `eslint.config.mjs` now declares Node's globals for `**/*.cjs` only |
| Rules weakened? | — | **No.** No rule disabled, no file ignored, no change to the benchmark's measurement logic. |

## Fault-injection harness exit code

**Exact failure**: crashing the disposable PostgreSQL (`pg_ctl -m immediate`) disconnects the idle clients of the harness's own `pg.Pool`; `pg` emits `'error'`; there was no listener, so Node raised an uncaught exception *after* the assertions passed → vitest "Unhandled Errors" → exit 1.

**Fix** (`test-fault/pool-errors.ts`, `harness.ts`, three test files):

- `PoolErrorPolicy`: connection-loss errors (`57P01/57P02/57P03`, `ECONNRESET`, `ECONNREFUSED`, "Connection terminated", "terminating connection", "database system is … recovery") are **expected only inside an outage the test declared** (`crash()` opens it, `start()` closes it). Everything else — a connection error with no declared outage, or any non-connection error even during an outage — is recorded.
- Pools from `DisposablePg.pool()` are tracked; teardown calls `closePools()` (a broken pool cannot mask the real result), awaits `api.kill()` and `redis.kill()` (the latter now waits for the process to exit), destroys the cluster, **then** `errors.assertClean()` throws if anything unexpected was recorded, in `finally`, so cleanup always happens first.
- No global handler, no catch-and-ignore.

**Verification (TODAY)**

| Check | Result |
|---|---|
| Harness self-test (`pool-errors.test.ts`, 4 tests, no database): outage + connection loss expected; same error with no outage fails; non-connection error during outage fails; window closes at `endOutage()` | 4/4 pass |
| `npm run test:fault` | **exit 0**, 14 passed + 1 skipped (`start-ab`, `RUN_BENCH=1`) |
| Unexpected error still fails the run | throwaway test (deleted): assertions pass, then `assertClean()` throws → **vitest FAIL, exit 1** |
| Leaks | no `oes-fault-*`/`oes-bk-*`/`oes-restore-*` directories, no stray postgres/redis processes afterwards; the shared Redis (:6390) kept running; shared dev DB still 12,023 users |
| Shared infrastructure | the harness's hard guard still refuses `:5433`/`:6390`; no Redis flush outside the disposable instance |

## Shared package: `node:crypto` out of the browser bundle

`packages/shared/src/exam-rules.ts` imported `node:crypto`; the barrel re-exported it; Turbopack therefore shipped a crypto polyfill (elliptic, des.js, hash.js) to every browser, which also fired a CSP `eval` report (`is-generator-function` feature test) on every page.

- `answerDigest` and `receiptCode` moved to `packages/shared/src/server.ts`, exposed as `@oes/shared/server` (`exports` map for Node/bundlers, `typesVersions` for the API's `node10` resolution). Only `delivery.service.ts` imports them.
- Largest client chunk: **457,695 → 229,597 bytes** right after the change, 234,821 bytes in the final build (the error pages were added later) (TODAY, `.next/static/chunks`).
- `browser-safety.test.ts` (7 tests): every module re-exported by the barrel must import no Node built-in; the barrel must not export `server`. Proven to fail when `import … from 'node:crypto'` is added back to `exam-rules.ts`.
- Behaviour unchanged: the existing digest/receipt unit tests moved to import from `./server` and pass; API integration tests (digest/receipt on submit) pass.
