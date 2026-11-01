# Reliability test results

## Status: **NOT RUN in this session — no result below is a result of this work.**

Reason (verified): the sandbox cannot reach the npm registry or `www.hostinger.com` (network allow-list), so dependencies could not be installed, nothing was built and no test was executed. PostgreSQL 16 and `redis-server` binaries exist locally, so the scenarios *can* be run once dependencies install. No result is mocked or estimated.

## What was executed
| Item | Result |
|---|---|
| Hostinger account read-only queries (VPS list, website list, DNS zone, orders) | done — facts in doc 01/07 |
| `docker compose config` on the (earlier, VPS-oriented) template | valid — not part of this plan |
| TypeScript **syntax** parse of new/changed files | no syntax errors — **not** type-checking, **not** running |
| Student / staff / API production builds | **not run here**. CI evidence (run 20, commit b4ae2cf): `node24` job **passed** (npm ci, typecheck, lint, `npm test`, `npm run build` of web+api, and `main.js`/`worker.js`/`cron/reconcile.js` exist). `verify` (Node 26) passed the same steps and failed only at `test:e2e` (known: this branch's ci.yml lacks the `.env`/redis-tools steps added in PR #2). Build in CI is a monorepo build, not the exact hPanel per-app build; Node 24 at runtime on Hostinger is still unproven |
| Any test | **not run here** |

## The 14-step scenario, mapped to existing tests (run by the other session on local disposable infrastructure; not re-run)
| # | Step | Existing test that covers it | Covers the hosted path? |
|---|---|---|---|
| 1–3 | log in, begin exam, save answers | `tests/e2e/exam.spec.ts` full sitting; `apps/api/test/exam-engine.test.ts` | no (local stack) |
| 4–6 | Redis unavailable, save again, confirmed answers remain in PostgreSQL | `fault.test.ts` E; `control.test.ts` "Redis lost while an examination is running" | no (local Redis kill, not a managed-service outage) |
| 7 | worker interrupted | `control.test.ts` "API process killed and restarted with a backlog" | no |
| 8–9 | deadline passes, late change rejected | `exam.spec.ts` "server clock rules…auto-submitted receipt"; `fault.test.ts` F | no |
| 10–11 | worker resumes, finalization reconciled | `control.test.ts` "restart reconciles the backlog immediately… nothing sealed twice" | no |
| 12 | grading exactly once | `control.test.ts` sealed-once assertions; schema unique (exam, student) + `result.upsert` | partly (database enforced) |
| 13 | submission receipt remains valid | `fault.test.ts` B, C (replayed receipt) | no |
| 14 | campus monitoring reflects final state | `exam-control.spec.ts`, `metrics.test.ts` | no |

## What the hosted topology adds that nothing tests yet
External PostgreSQL over TLS and a pooler; external Redis over TLS; Next `rewrites`/BFF to an external API; Hostinger proxy behaviour (headers, `X-Forwarded-For`, 120 s limit, response streaming); the external worker; cron; Node 24. These are doc 10 tests A-*, B-*, C-*, D-*.

## Capacity
**No claim.** The only measurement in the repository is 2 000 synthetic candidates × 50 questions (100 000 acknowledged answers, 0 lost) on one 4 vCPU / 16 GB machine running API, PostgreSQL, Redis and the load generator together. A Hostinger Cloud Enterprise plan's concurrency is **unknown**; CPU/RAM per site were not obtained. A representative, approved load test on the real staging topology (doc 10 C-6) is required before any institutional use. 5 000 or 20 000 simultaneous candidates are **not** supported by any evidence.
