# Institution & programme directory

Status: implemented on branch `claude/vigilant-cori-2lo8uc`. **The migration has not been applied to any live database and nothing has been deployed.** Dataset version `2026-11-06.1`.

## Data relationships

```
AwardingBody ──┐
Institution ───┼─< InstitutionProgramOffering >── Program ──< Course (subject) ── Enrollment
 kind, type,   │        │  intakeStatus, intakeStoppedFromBatchYear, verificationStatus, lockedFields
 sector,       │        ├─< OfferingAllocation   (per shift; annualSeats nullable = "not published")
 affiliation,  │        └─< OfferingSession      (per admission year; OPEN/CLOSED, optional seatLimit)
 region, city, │
 listingStatus,│  Program ──< CurriculumDocument (official PDF located; not the same as subjects entered)
 operationalStatus, isDemo, directoryKey, lockedFields
DirectorySource ──< DirectoryClaim (provenance, restrictions, unresolved items; sessionLabel, effectiveFrom nullable)
DirectoryImportRun ──< DirectoryImportChange (what a run created/updated, for rollback)
Student ── institutionId + programId + shift ;  RosterEntry / CourseAssignment keep their (institution, programme) pair
```

* **Kept separate on purpose**: listing status (may a user pick it), operational status (is it running), offering verification, intake status (new students), per-session admissions, existing cohort enrolment (actual `students` rows), and examination eligibility (roster + exam rules, untouched by the directory). Published annual seats are reference data and are never used as a limit unless an administrator sets an explicit session `seatLimit`.
* A new offering **never** creates classes, exams, assignments or eligibility.
* Keys: institutions `directoryKey` (+ `code` `SZ-A01…`, `SZ-B01…`, `SZ-C01…`, `SZ-U01…`), programmes `directoryKey` (e.g. `DPT`, `BSN_GENERIC`). Matching is by stable key only; there is no name-similarity merge. Ambiguities are reported, and resolved only with `--link directoryKey=CODE`.

## Counting definitions

| Term | Definition |
|---|---|
| Institution | `Institution.kind = INSTITUTION` (30 baseline rows: 6 constituent, 4 government affiliates, 20 private affiliates) |
| University academic unit | `kind = ACADEMIC_UNIT` (4: IRS, Public Health, Health Professions Education, Molecular Biology / BMS) – never counted as institutions |
| Programme (canonical) | one `Program` row = 60 definitions in dataset `2026-11-06.1` (affiliation catalogue + university catalogue) |
| Offering | one `InstitutionProgramOffering` row = one institution ↔ one programme. 98 = 86 at the 30 institutions (11 / 3 / 72) + 12 at academic units |
| Verified programme count (list screen) | offerings with `verificationStatus = VERIFIED` for that institution |
| Allocation | one row per shift (HBS and Rawal BSN: morning 100 + evening 100 = 2 rows; single-shift offerings: 1 `UNSPECIFIED` row). 100 in total; unknown seats are `NULL` |
| Student count | actual `students` rows for the institution; `0` is a real zero. Demo institutions are excluded from production totals when `DEMO_INSTITUTIONS_VISIBLE` is off |
| Restricted | an offering with `intakeStatus = STOPPED` – Aman Medical Institute DPT, IHMS DPT, Kulsum Post RN BSN |

## Restrictions and how they were tested

Stopped intakes (`SZ-C02/DPT`, `SZ-C09/DPT`, `SZ-C12/BSN_POST_RN`) each carry a verified claim from the official *Our Institutes* page with `effectiveFrom = NULL` (no effective date is published). Behaviour: a new student cannot select them (`INTAKE_STOPPED`, 409, server-side, also for admin create/import/update); a student already on the campus register (trusted), or an existing cohort at/after an administrator-set `intakeStoppedFromBatchYear`, is not blocked; existing students, classes and exams are never touched. Tests: `directory-flows.test.ts` (onboarding, admin create/import/patch, roster import, teacher/lecturer assignment, exam roster, session `CLOSED` / `SESSION_FULL`, shifts), `directory-api.test.ts` (indicator, edit, audit, import does not undo an administrator’s edit), `directory-import.test.ts`, `tests/e2e/directory.spec.ts` (warning + server refusal in the browser).

## Demo (synthetic) records

`DMC-A`, `DMC-B`, `DNC-C` and four demo courses keep their ids and data, flagged `isDemo` by the migration (name ends “(synthetic)”; hand-added real rows are not touched). With `DEMO_INSTITUTIONS_VISIBLE` unset/false they are absent from student and teacher selection, new registration there is refused (`INSTITUTION_NOT_LISTED`), and they are excluded from the super-admin dashboard totals. A university-wide manager can still list them (`/directory/institutions?demo=only|include`). Genuine users found on a demo institution are moved with the explicit, audited **`POST /api/directory/reassign-students`** (super-admin only; target must be an existing real offering; refused for any student with examination history; all-or-nothing; reason required). Demo rows are never renamed into real ones. **Live site: leave `DEMO_INSTITUTIONS_VISIBLE` unset.**

## Import (repeatable, safe)

* Stable keys, one transaction, `GET_LOCK('szabmu_directory_import')` (a second run fails fast), version/actor/timestamp/outcome in `directory_import_runs`, every change in `directory_import_changes`.
* Dry run is the default: it performs the real operations and always rolls back.
* Administrator edits are recorded in `lockedFields` and are **reported as a discrepancy, not overwritten**, on the next import.
* Rollback undoes only the changes of one run; anything that gained dependents since (students, assignments…) is delisted, not deleted, so later records survive.

### Exact commands for the target environment

```bash
# 1. back up the database first (hPanel backup or mysqldump), then apply additive migrations
npm run db:migrate            # or let the Hostinger launcher auto-apply on deploy; the directory import is NOT run automatically
# 2. read-only check of the baseline against the committed snapshot (add -- --live to re-check the official page)
npm run directory:verify
# 3. dry run (default): prints created/reused/updated counts, ambiguities, discrepancies; writes nothing
npm run directory:import
# 4. apply
npm run directory:import -- --apply --actor "NAME"
# 5. if needed, inspect and then undo one run
npm run directory:rollback -- RUN_ID
npm run directory:rollback -- RUN_ID --apply --actor "NAME"
```

Expected first dry run on a database with only the demo universe: institutions 34 created, programmes 59 created + 1 updated (MBBS keeps its existing name; reported), offerings 98, allocations 100, curriculum documents 49, 3 stopped.

## Where it is enforced (server side)

`directory/rules.ts` is the single rule set: `assertOffered`, `assertEnrollmentAllowed` (stopped intake, session closed/full, shift), `assertNotHiddenDemo`, `outsideSzabmuPairs`. Used by student onboarding, admin student create/import/update, roster import, teacher registration and lecturer assignment, cohort (`enrol`) and exam roster refresh. Every `/directory` route has exactly one `@Perm` (`institution.read` / `institution.manage`) and is scoped by the caller’s institutions; campus administrators get 404 for other campuses. Teachers get no results access; AI does not touch marks, eligibility or exam state.
