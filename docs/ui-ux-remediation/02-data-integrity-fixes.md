# 02 — Data-integrity fixes (UI-002)
**Root cause.** `PATCH /institutions/:id` used `instDto.partial()`. In zod v4 `.partial()` keeps `.default('CONSTITUENT')`, so every PATCH (including the Activate/Deactivate button) silently rewrote `affiliation`, turning AFFILIATED colleges into CONSTITUENT.

**Fix.** Default-free `instPatch`; `updateInstitution` loads the stored row (404 if missing), computes `changes` for supplied-and-different fields only, writes only those, returns the row unchanged (and writes no audit) for a no-op, and audits `meta.changes` with before/after. Create keeps its default.

**Tests.** `apps/api/test/institution-update.test.ts` (9 tests). Run against the old code, 4 of 9 failed; all pass now. Browser: `tests/e2e/institutions-confirm.spec.ts` verifies affiliation survives a deactivate/activate cycle.

**Existing-data discrepancy report (no guessing, no auto-restore).** `scripts/report-institution-discrepancies.sql` is read-only. Against the shared dev database: the audit log contains **no `institution.update` entries**, so no institution can have been altered by this bug there; zero discrepancies. If any environment shows entries, the report lists them with before/after for a human to decide; historical affiliations are **not** inferred or restored automatically.

**Related.** Phone-number validation (UI-032): shared `isValidPhone`, enforced in `PATCH /auth/profile`, user create DTO and guardian phone, with an inline client error. `phone-validation.test.ts`, `phone.test.ts`, shell-accessibility spec.
