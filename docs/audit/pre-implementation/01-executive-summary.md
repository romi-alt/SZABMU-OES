# 01 — Executive Summary

**Audit date:** 2026-10-31 · **Branch:** `claude/oes-platform-foundation` · **Auditor note:** this repository was built in a prior session by the same AI agent performing this audit. That is a conflict of interest. Treat every "verified" below as "verified by the author's own tests" and obtain an independent human review before pilot sign-off.

## Verdict

**Stage 5 (integrated system undergoing stabilisation), lower edge. Not pilot-ready.** Stage 4 (complete primary exam workflow) is met for the MCQ path: candidate sit → durable autosave → server-timed submit → auto-grade → staff review → publish → verifiable certificate record. Stage 6 is blocked by the gaps below.

Continue development. A rewrite is **not** warranted: the exam engine, schema, RBAC/scope model and audit chain are sound, tested, and should be preserved.

## Evidence of what works (re-run in this audit)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 (shared, api, web) |
| `npx eslint .` | exit 0 |
| `npm test` shared (Vitest) | 15 / 15 pass |
| `npm test` api (Vitest, real PG 16 + Redis, isolated `_test` DB, Redis db 1) | 96 / 96 pass |

Not re-run (would write to the dev DB or are heavy): Playwright (13 passed in the previous session), load test (results below are from the previous session). Both are reported as *prior results*, not fresh evidence.

## Five most serious risks

1. **Scale unproven.** Largest measured run: 2,000 synthetic candidates × 50 questions on one 4-vCPU box shared with PG/Redis/load generator (start p95 1.9 s, save p99 246 ms, 0 lost answers). 5k/10k/20k are untested. No PgBouncer, no replicas, single API process model tested only.
2. **~Everything after commit `4068c8f` is uncommitted** (docs, infra, CI workflow, load test, delivery optimisation, e2e hardening). One container loss destroys it.
3. **Crash-durability not tested.** No test kills the API/PG mid-exam and verifies recovery. Design supports it (every ack is a committed txn), but it is NOT VERIFIED.
4. **Large functional gaps against the brief:** no lecturer↔course assignment, no material upload / object-storage adapter, no subjective grading, no 2FA, no system settings, no PDF certificate, no live push (monitor polls), no exam-wide pause/extend, no sub-campus/venue model (campus ≡ `Institution`; venue is free text).
5. **Operational unknowns:** `docker compose` stack never run (no Docker daemon here); no backup/restore, metrics, or alerting; `npm audit` untriaged; no accessibility or mobile verification.

## Preserve unchanged
`delivery.service.ts` save/submit SQL and invariants, `exam-engine.ts` client queue, DB integrity migration (triggers/CHECKs), `scope`/`@Perm` model, audit hash chain, four-eyes rules, frozen paper snapshots.

## Next task
See `13-next-implementation-prompt.md`. In one line: **commit the work, then prove durability and scale (crash/restart tests, 5k run with PgBouncer) before adding features.**
