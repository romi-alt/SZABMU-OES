# 02 — Security fixes

## S1 — Cross-campus aggregate disclosure (`D-09`) — FIXED

**Trace** (HTTP → response):

| Layer | Finding |
|---|---|
| Controller | `@Perm('report.read') @Get('reports/institutions') inst()` — **no `@CurrentUser`, no query parsing** |
| Authentication | session guard ran correctly (401 when anonymous) |
| Role authorization | `report.read` is held by Campus Admin, Examiner, CCE, Super Admin; it is a *capability*, not a *scope* |
| Scope resolution | never called: the handler could not know who asked |
| Service | `institutionSummary()` had no parameters; SQL selected every institution |
| Serialization | returned name + student count + user count for every campus |

**Root cause**: authorization was expressed only as a permission; data scope was a separate, per-query convention (`scope.filter(u)`), and this route forgot it.

**Fix** (`reports.controller.ts`, `reports.service.ts`): the handler receives the caller; the service selects **in SQL** only `u.institutionIds` (university-wide roles have `null`); an optional `institutionId` narrows the result, and naming an institution outside the caller's scope is **403** (not filtered silently, not 200 with a partial body). Nothing is hidden by the frontend.

**Policy applied** (from the brief, mapped to the roles that exist):

| Brief | Implementation |
|---|---|
| Super Admin | university-wide (`institutionIds = null`) |
| Controller of Examinations | university-wide (his role definition; `report.read`) — the brief's "within assigned authority" is satisfied by the role's permission set, there is no per-CCE institution assignment in the data model |
| Institution Admin | **no such role exists**; Campus Admin with several `user_institutions` rows is the closest, and gets exactly those |
| Campus Admin | only assigned campuses |
| Lecturer / Invigilator / Student | `report.read` is not granted → 403 |

## S2 — Exam views leaked other campuses — FIXED (found by the new sweep)

`GET /exams/:id` and `GET /exams` returned every participating campus (`institutions` with id/code/name) and whole-exam `candidates`/`attempts` counts to campus-scoped staff. The HTTP-facing `ExamsService.detail()` (new) and `list()` now return only the caller's campuses and counts restricted to the caller's campuses. The internal `load()` is deliberately unchanged (other methods need the full participant list).

## Review of similar services

| Area | Result |
|---|---|
| Controllers whose handlers ignore the caller | one found (`inst()`), fixed; scan: every other `@Get/@Post/...` handler takes `@CurrentUser` |
| Dashboard aggregates | scoped (`scope.filter`) — now asserted (`dashboard aggregates for a campus admin count only their campus`) |
| CSV export, exam report, results list | scoped in SQL; now asserted on bodies for admin.a, admin.b, CCE |
| Audit list, notifications broadcast | already scoped; covered by the sweep |
| Search (`/students?q=`) | covered by the sweep |
| Live monitor | scoped (existing tests) and in the sweep |
| PDF reports, file downloads, event subscriptions | **do not exist** (no PDF generator, no file store, no SSE) — nothing to scope; the sweep must be extended when they are added |

## Regression tests (`apps/api/test/campus-isolation.test.ts`, 17 tests, assert on response bodies)

1 own campus aggregate · 2/3 no other campus, no university-wide list · 4 `institutionId` manipulation → 403 and no disclosure, own id → 200, malformed → 400 · 5 `campusId`/`scope=all`/`institutionIds`/array-style parameters cannot widen · 6 two approved campuses see exactly two (not the third) · 7 revoked assignment loses access immediately (old session 401 or own-only; new login own-only) and the shared fixture is restored in `finally` · 8 CCE/Examiner/Super Admin university-wide and `institutionId` narrowing · roles without `report.read` → 403 · 9 CSV/exam report/results list/dashboard campus-filtered, CCE sees both · 10 unauthenticated → 401 · structural sweep: 21+ GET routes as admin.a, admin.b, invigilator.a/b, lecturer.a/b — no foreign id, code or name anywhere in any body.

Before the fix 13 of the first 13 tests failed (TODAY); after: all pass.

## S3 — Bundle contained Node crypto (`@oes/shared`) — FIXED

See `03` (shared package) and `05` (CSP): server-only `answerDigest`/`receiptCode` moved to `@oes/shared/server`; a test fails if any module re-exported by the barrel imports a Node built-in.

## Not changed (recorded, see `07`)

Answer keys plaintext at rest (P-27); rate limiters fail open without Redis (P-28); the Users page still renders its admin furniture to a student before showing the access-denied panel (no data is exposed).
