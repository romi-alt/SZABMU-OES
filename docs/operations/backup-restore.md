# Backup & restore runbook

**Status: logical backups implemented and verified in isolation. Point-in-time recovery (WAL archiving), encryption, scheduling and off-site copy are NOT implemented** — see "Gaps" before relying on this in any shared environment.

## What exists
`scripts/db-backup.mjs` (needs `pg_dump`/`pg_restore`/`initdb`/`pg_ctl` 16 on the machine; set `PG_BIN` if not `/usr/lib/postgresql/16/bin`):

| Command | Does |
| --- | --- |
| `npm run backup:db -- --url "$DATABASE_URL" --out /secure/backups` | Read-only. Consistent snapshot (`pg_export_snapshot` + `pg_dump --snapshot`, so concurrent exam writes cannot tear it), custom-format dump, SHA-256, and a manifest with per-table row counts and order-independent content fingerprints taken on the **same snapshot**. Output is explicitly labelled *NOT verified*. |
| `npm run backup:verify -- --backup /secure/backups/oes-<ts>.dump` | Restores into a **disposable** PostgreSQL cluster (temp dir, random localhost port; never a shared server) and checks: file checksum · restore succeeds with `--exit-on-error` · every table's count + fingerprint equals the manifest (and no extra tables) · migration history identical · append-only/lock triggers present · `audit_logs` still rejects UPDATE. Exit 0 = verified, 1 = failed, 2 = usage. `--keep` leaves the restored cluster running and prints its URL (for the application-level check below). |

**Acceptance rule:** a backup is *operational* only after `backup:verify` has exited 0 for that file. Keep the `.dump`, `.sha256` and `.manifest.json` together.

## Tests (`npm run test:fault`, file `backup-restore.test.ts`)
Disposable source cluster with a sealed attempt and three candidates still saving while the backup runs → backup → verify (restore + compare) → boot the API on the restored copy: `/audit/verify` hash chain intact, candidate's session and sealed receipt/answers intact → corrupt one byte of the dump ⇒ checksum failure (exit 1); alter a manifest fingerprint ⇒ content mismatch (exit 1); missing file ⇒ exit 2. Measured on the synthetic seed: 126 KB dump, 35 tables, 567 rows.

## Restoring for real (disaster recovery)
1. Run `backup:verify` on the chosen backup first (it will still pass/fail the same way).
2. Provision an empty PostgreSQL 16 database (same major version) and role.
3. `pg_restore --exit-on-error --no-owner --dbname "$NEW_DATABASE_URL" oes-<ts>.dump`
4. Point `DATABASE_URL` at it, start the API (`prisma migrate deploy` must report nothing to apply), call `GET /api/audit/verify` as CCE/Super Admin (expect `brokenAt: null`), flush Redis (it holds only caches and password-reset tokens).
5. Record the incident, the backup id used, and the data window lost (see RPO).

## Gaps (honest)
- **RPO = backup interval.** Logical dumps only; anything after the last backup is lost. For exam days run a backup immediately before opening and after closing, and design PITR (continuous WAL archiving to object storage + `pg_basebackup`, tested with a timed restore) before any pilot.
- **No encryption.** Dumps contain personal data and answer keys. Encrypt before they leave the host (e.g. `age`/GPG) and restrict the directory; key custody is a policy decision (P-19 / security doc).
- **Not scheduled, not shipped off-site, retention not enforced.** A scheduler (cron/CronJob), off-site copy and a retention/rotation policy are required.
- **Not measured at scale.** Fingerprinting and restore time have only been run on the ~500-row synthetic data set. RTO for a 20,000-candidate database is unknown; measure with a production-size synthetic database.
- Redis is deliberately excluded (cache + reset tokens only).
- Restore verification runs on the same machine type as the source; it proves the dump is restorable and complete, not that a different PostgreSQL minor version/extension set behaves identically.
