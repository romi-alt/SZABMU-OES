# 07 — Campus permissions

## Authority model

| Role | View command centre (`exam.control.view`) | Issue commands (`exam.control`) | Approve suspension time policy (`exam.control.policy`) | Campus monitoring (`invigilation.monitor`) | Per-candidate extend / force-submit (`invigilation.intervene`) |
|---|---|---|---|---|---|
| Super Admin | ✓ all campuses | ✓ | ✓ | ✓ all | ✓ |
| Controller of Examinations | ✓ all campuses | ✓ | ✓ | ✓ all | ✓ |
| Examiner | ✓ (read-only) | ✗ | ✗ | ✓ all | ✗ |
| Campus Administrator | ✗ | ✗ | ✗ | ✓ own campus(es) | ✗ |
| Invigilator | ✗ | ✗ | ✗ | ✓ campus where **assigned to this exam** | ✓ own campus candidates |
| Lecturer | ✗ | ✗ | ✗ | ✗ | ✗ |
| Student | ✗ | ✗ | ✗ | ✗ | — (own candidate stream/state only) |

Campus staff therefore gain **no exam-wide authority**: every control endpoint, including `extend/preview` and `policy`, answers 403 to them (tested for six roles × eleven endpoints, plus 401 anonymous). MFA is the existing guard (CCE, Examiner, Campus Admin, Super Admin are MFA roles); nothing here bypasses it.

The brief's "Institution Administrator" role does not exist in this system (Campus Administrator with several `user_institutions` rows is the closest, and receives exactly those campuses). The CCE is university-wide by role; there is no per-CCE institution assignment in the data model.

## Scope enforcement

One function decides what a staff user may see of an exam: `MonitorService.staffViewer` — invigilators only where assigned to the exam (∩ their scope), everyone else their institution scope; no scope → 404 (existence not disclosed). It feeds **all three** read paths:

| Path | How scope is applied |
|---|---|
| Snapshot | the shared per-exam aggregate is filtered to the viewer's campuses in memory; totals are recomputed from the filtered campuses (a campus user never sees another campus's number) |
| Candidates | campus filter is part of the SQL; naming a campus outside scope returns an empty page rather than widening |
| SSE (live and replay) | `visibleTo(event, viewer)`: exam-wide events + events of the viewer's campuses; a campus-B-targeted event is not delivered to campus-A staff |
| Candidate streams/state | roster membership required (404 otherwise); campus and identity filters; internal reasons are never in payloads |

## Regression guard against the earlier report leak

`campus-isolation.test.ts` (17 tests, response-body assertions) and its structural sweep now also cover exam detail/list; `exam-control.test.ts` adds: campus-A staff snapshot/candidates/compat monitor contain no `DMC-B`; `?institutionId=<B>` returns an empty page; a de-assigned invigilator gets 404; student/lecturer get 403; `exam-control-stream.test.ts` proves campus-B events never reach campus-A streams, over real sockets. The key-confidentiality sweep (all student GET routes) still passes, with the two long-lived streams excluded by name and covered by their own test.
