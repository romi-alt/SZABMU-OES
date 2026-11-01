# 06 — Database and migration plan

**Nothing has been migrated, copied or deleted. No production database exists yet.**

## Decision: a new, empty production database

The only existing databases are development and test databases. Evidence that they must not be copied:

| What the existing data contains | Source |
|---|---|
| Synthetic demo accounts for every role, one password for all, e-mail domain `demo.szabmu.invalid` | `apps/api/src/seed/seed.ts` (`DEMO_PASSWORD`, `DOMAIN`) |
| Load-test candidates provisioned straight into the database, thousands of synthetic answers | `tests/load/exam-load.mjs`, docs/implementation-status.md |
| Sample question bank and the demo paper "Pathology Mid-term (DEMO)" | `seed/content.ts` |
| Answer keys stored in plaintext (open policy item P-27) | docs/implementation-status.md |
| Audit hash chain rooted in test activity | `audit_logs` |

The production database therefore starts **empty at schema level**, receives only **reference data and real people**, and is never populated by the seed (it refuses `NODE_ENV=production`).

## Creating the schema (gated step, not run)

1. PostgreSQL 16 container with TLS (`ssl=on`, self-signed server certificate is enough because the network is private and `sslmode=require` is what the API's config gate demands). Certificate and key are generated **on the VPS** (`certs/postgres/`, git-ignored).
2. `prisma migrate deploy` applies the **8** existing migrations (`init`, `integrity_constraints`, `exam_term_review`, `eligibility_roster_overrides`, `lecturer_course_assignments`, `staff_mfa`, `exam_live_control`, `exam_force_close`). Run as a one-off container step, **never on API boot** (the Dockerfile comment says the same).
3. Verify: migration history complete, the integrity triggers exist (append-only audit/answer journal, immutable sealed attempts), `GET /api/audit/verify` reports `brokenAt: null` on the empty chain.

### Foundation is still moving
New migrations keep landing (two arrived while this plan was written). Before the real run: pin the release commit, diff `apps/api/prisma/migrations` against what the rehearsal ran, and run the rehearsal on that exact commit.

## What goes in, in order

| Step | Content | How | Gap |
|---|---|---|---|
| 1 | **First Super Administrator** | **No tool exists (G1).** Needs a one-off, audited bootstrap command: refuses if any SUPER_ADMIN exists, takes the e-mail from the environment, generates a temporary password shown once, sets `mustChangePw`; MFA enrolment is then forced by `MFA_ENFORCE`. | Backend change B1. |
| 2 | Institutions, departments, programs, courses | Through the Super Admin UI/API (`POST /institutions`, `/programs`, …) from the university's official list | none |
| 3 | Staff accounts | Campus/Super admins create them (`POST /users`); each gets a temporary password and must change it; MFA enrolment forced for four roles | decide LECTURER/INVIGILATOR MFA |
| 4 | Real students | `POST /students/import` (bulk) by campus admins; temporary passwords delivered out of band | confirm the import format against the real registry export |
| 5 | Enrolments, lecturer course assignments | `POST /enrollments/bulk`, assignments page | none |
| 6 | Question bank and papers | Authored and approved through the application's four-eyes workflow | none |

No synthetic or demo record, no load-test student, and no confidential paper is created in production by tooling.

## Backup and restore (required before any real exam)

Existing: `npm run backup:db` / `backup:verify` — consistent snapshot, checksum, manifest, restore into a disposable cluster. **Missing**, all required before real use (docs/operations/backup-restore.md "Gaps"):

| Need | Plan |
|---|---|
| Schedule | cron/systemd timer on the VPS: every night, **plus** immediately before an exam opens and after it closes |
| Encryption | `age` (or GPG) before the dump leaves the host; key held by the examinations office, not on the VPS |
| Off-box copy | object storage or a second host; retention rule |
| Point-in-time recovery | WAL archiving (e.g. pgBackRest) — not implemented; until then RPO = backup interval |
| Restore drill | restore the latest backup onto a scratch host monthly and before launch; record the measured RTO |
| Hostinger snapshot | an extra layer only, never the sole backup |

## PostgreSQL settings (starting point for 16 GB, one host)

`synchronous_commit=on` (an answer is "Saved" only after a durable commit — do not trade this away), `max_connections=200` with `DB_POOL_MAX=20` per API process, `shared_buffers=3GB`, `effective_cache_size=8GB`, `wal_compression=on`, `log_min_duration_statement=500`. Tune only after the load rehearsal on this VPS.

## Rollback

Before the first real data: destroy and recreate the empty database. After real data exists: restore the last verified backup; never run a down-migration by hand. A failed migration on an empty database is a rehearsal finding, not an incident.
