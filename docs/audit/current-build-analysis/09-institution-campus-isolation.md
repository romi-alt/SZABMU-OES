# 09 — Institution / campus isolation

## Model

`Institution` (type enum, affiliation), `Department`, `Program`, `Course`, `Student`(institution), `UserInstitution` (staff scope), `ExamInstitution`, `ExamCandidate`(institution), `ExamInvigilator`(per campus). Scope is applied in services (`scope.filter`, `scope.assert`); Student/Lecturer/Campus-admin/Invigilator are campus-scoped, Examiner/CCE/Super Admin are university-wide limited by permission (`docs/role-permissions.md`).

**Not modelled**: rooms, seats, exam centres distinct from campuses, batches/cohorts, exam-day attendance. `enrollments.attendance` is a course-attendance percentage used for eligibility, not a sitting register (`PATCH /enrollments/:id/attendance`). Distinct "Institution Administrator" role does not exist.

## Direct-request probes (TODAY, disposable stack, two seeded campuses DMC-A / DMC-B)

| Attempt | Result |
|---|---|
| admin.a `GET /students` / admin.b `GET /students` | only `DMC-A` / only `DMC-B` rows |
| admin.a `PATCH /students/<campus-B id>` | 404 |
| student.a `GET /attempts/<B attempt>/sheet`, `/receipt`; `PUT …/answers/…` | 404 / 404 / 404 |
| invigilator.a / admin.a / admin.b monitor of the same exam | rows limited to own campus (A / A / B) |
| admin.a `force-submit` of a campus-B attempt | 403 (no `invigilation.intervene`) |
| invigilator.a `force-submit` of a campus-B attempt | 404 |
| lecturer.b `GET /questions/<lecturer.a question>` | 404 |
| admin.a `GET /results/exams/<id>` before publication | 403 |
| student `GET /me/results` before publication | `[]` |
| Anonymous `GET` on users/students/exams/audit/reports/incidents | 401 |
| `POST /auth/logout` with `Origin: https://evil.example` | 403 |
| `/metrics` without token | 404 |

Also covered by the suite TODAY (not re-probed): `security.test.ts` (deny-by-default, cross-campus IDOR on lists/details/aggregates, exports), `course-access.test.ts` (lecturer ↔ course, other campus, other program, key non-leakage), `eligibility.test.ts` (override authorization for 5 roles + anonymous).

## Not probed (explicitly)

- **SSE subscriptions**: not applicable (none exist).
- **File downloads**: no file store exists; CSV export is campus-filtered in SQL (`reports.service.ts:109`) and campus admins get it only after `PUBLISHED`.
- Search endpoints other than `/students?q=` (the probe returned a result set; the campus of every item was not tabulated — covered by `security.test.ts` rather than re-proven here).
- Aggregate endpoints beyond what `security.test.ts` asserts — see the verified finding below.

## Verified isolation weakness (TODAY, MEDIUM)

`GET /api/reports/institutions` (`report.read`, which Campus Admin holds) calls an unscoped `institutionSummary()` (`reports.service.ts:113-118`). Live probe as `admin.a` (DMC-A): **HTTP 200** listing every campus including `DMC-B` (6 students, 9 users) and `DNC-C`, with names, student counts and user counts. Individual records stay isolated, but another campus's identity and headcounts are disclosed. Under the audit's own rule ("report any data isolation weakness") this is **MEDIUM** (disclosure of counts/names only, no personal data). Fix: apply `scope.filter(u)` or restrict the permission; add the all-routes campus-A test recommended below. Registered as `D-09`.

## Verdict

No cross-campus access to individual records was found in the exercised paths, but one MEDIUM aggregate disclosure was verified (`D-09`, above). Isolation of exports, aggregates and item analysis relies on per-query filters rather than database row-level security: every new query must remember `scope.filter(u)` (the route manifest checks permissions, not scoping). Recommendation: add a test that, for each list/aggregate route, runs as campus-A and asserts no campus-B identifier appears in the response.
