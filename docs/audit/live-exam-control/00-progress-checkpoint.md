# Live exam control — resumable progress checkpoint

(Working file; superseded by the numbered documents when the module is complete.)

## Done (uncommitted unless noted)
- Schema + migrations `20261101002107_exam_live_control`, `20261101002607_exam_force_close` (new states ADMISSION_OPEN/SUSPENDED/CLOSING/SCORING, timing/control policy, suspensions, extensions, command ledger, outbox `exam_events`, lifecycle lease/runs). Apply from scratch verified.
- Shared: permissions `exam.control.view|exam.control|exam.control.policy`, `computeSyncDeadline` (+tests), role doc regenerated.
- API `src/modules/control/`: `exam-state.ts` (state machine), `transition.ts`, `events.service.ts` (outbox + hub + Redis fan-out + DB catch-up), `monitor.service.ts` (bounded snapshot/candidates), `lifecycle.service.ts` (DB lease reconciler), `control.service.ts` (9 commands + policy + view), `control.controller.ts` (REST + SSE).
- `audit.append(tx)`, metrics additions, delivery changes (start gating, sync deadline, suspended save predicate, heartbeat state + hbz zsets, `sealIfExpired`).

## Next
1. Register providers/controller in `app.module.ts`; JobsService → lifecycle (drop BullMQ sweep); delete `ResultsService.tick`.
2. Old `/invigilation/exams/:id/monitor` → compat via MonitorService (bounded).
3. Create-exam DTO: timingPolicy/controlMode. Regenerate route manifest (`UPDATE_ROUTE_MANIFEST=1`).
4. Tests (`apps/api/test/exam-control*.test.ts`, fault tests for Redis/restart on disposable infra).
5. Web: control centre `/exams/[id]/control`, campus monitor w/ SSE, student player reaction (suspended/waiting overlay, SSE → heartbeat).
6. Playwright specs; perf measurement with `tests/load`; docs 01–11; implementation-status; commits (do NOT push without authorisation).

Disposable stack for dev: `/tmp/stab-stack.sh start|stop` (PG :54397, Redis :6397), env in `/tmp/stab-env.sh` (recreate if missing).
