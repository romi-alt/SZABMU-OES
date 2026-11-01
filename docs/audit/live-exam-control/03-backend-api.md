# 03 — Backend API

All routes appear in `docs/route-permissions.md` (regenerated; the structural test fails on any route without a permission). Authentication, MFA state and campus scope are the existing guards.

## Commands — `exam.control` (CCE, Super Admin)

| Method / path | Body (zod-validated) | Result |
|---|---|---|
| `POST /exams/:id/control/open-admission` | `{idempotencyKey?, expectedVersion?}` | `{command, changed, version, state}` |
| `POST …/close-admission` | same | same |
| `POST …/start` | `+ extendWindow?` | `+ officialStartAt` |
| `POST …/suspend` | `{scope: EXAM\|CAMPUS\|CANDIDATES, institutionId?, studentIds?, reason≥10, incidentId?, confirm:true}` | `+ suspensionId, affected, timePolicy` |
| `POST …/resume` | `{suspensionId?, note?, confirm:true}` | `+ resumed, pausedSeconds` |
| `POST …/extend/preview` | `{scope, institutionId?, studentIds?, minutes 1–240}` | affected count, current/new earliest & latest deadline, window end before/after |
| `POST …/extend` | `+ reason≥10, confirm:true, idempotencyKey (required)` | `+ affected, closesAt` |
| `POST …/close` | `{force?, reason?}` (reason ≥ 10 when forcing) | `+ inProgress` |
| `POST …/reconcile` | — | reconciler stats |
| `POST …/initiate-scoring` | `{}` | `{changed, state}` |
| `POST …/policy` (`exam.control.policy`) | `{timingPolicy?, controlMode?, suspendTimePolicy?}` | before the exam starts; stamps approver |

Every response includes the fresh authoritative `state` (`status, stateVersion, admissionClosedAt, officialStartAt, closesAt, policies`). Errors: `400` validation/confirmation, `403` permission, `404` unknown/out-of-scope, `409` with a machine code: `BAD_STATE`, `PRECONDITION_FAILED` (all failures listed), `POLICY_NOT_APPROVED`, `WINDOW_TOO_SHORT`, `STALE_STATE`, `RESUME_OR_FORCE`, `AMBIGUOUS`, `NO_ACTIVE_ATTEMPTS`, `KEY_REUSED`, `ATTEMPTS_IN_PROGRESS`, `ALREADY_SUSPENDED`.

## Read model

| Path | Permission | Notes |
|---|---|---|
| `GET /exams/:id/control` | `exam.control.view` (Examiner, CCE, Super Admin) | header, available commands (with reasons), snapshot, suspension/extension history, last 30 events, health |
| `GET /invigilation/exams/:id/snapshot` | `invigilation.monitor` | campus-scoped aggregate; `cursor`, `stateVersion`, `freshness{computedAt, ageMs, degraded, reasons}` |
| `GET /invigilation/exams/:id/candidates` | `invigilation.monitor` | page ≤ 100, filters `institutionId, status, search`; `connection` and `lastConfirmedSaveAt` per row |
| `GET /invigilation/exams/:id/stream` | `invigilation.monitor` | SSE (see `05-event-system.md`) |
| `GET /invigilation/exams/:id/monitor` | `invigilation.monitor` | backwards-compatible shape, now bounded |
| `GET /me/exams/:id/state` | `exam.sit` | the candidate's authoritative fallback |
| `GET /me/exams/:id/stream` | `exam.sit` | the candidate's SSE |

## Candidate-facing contract changes (compatible additions)

- `POST /attempts/start` — new refusals: `EXAM_SUSPENDED`, `ADMISSION_CLOSED`, `WAITING_FOR_START` (synchronized lobby; no paper, no attempt); response gains `control{examStatus, suspended, timingPolicy}`.
- `PUT …/answers/:qid` — `409 EXAM_SUSPENDED` while suspended (enforced in the SQL predicate).
- `POST …/submit` — `409 EXAM_SUSPENDED` for a manual submit while suspended.
- `POST …/heartbeat` — also returns `suspended, suspensionPolicy, examStatus, stateVersion`; expiry is computed on the database clock, frozen-aware.
- `GET /me/exams` — lists the new states; `canStart` follows the control state; `timingPolicy`, `suspended`, `admission` added.
- `POST /exams` — optional `timingPolicy`, `controlMode`.

## Idempotency and versioning

Optional `idempotencyKey` on every command; **required** on extend. The ledger (`exam_commands`) stores the result; a repeat returns it with `replayed:true` and applies nothing; reusing a key for another command → `KEY_REUSED`. `expectedVersion` protects a UI that loaded an older state (`STALE_STATE`).
