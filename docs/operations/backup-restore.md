# Backup & restore runbook

**Status: logical backups implemented and verified in isolation. Point-in-time recovery (WAL archiving), encryption, scheduling and off-site copy are NOT implemented** — see "Gaps" before relying on this in any shared environment.

## What exists
`scripts/db-backup.mjs` (pure Node + the `mariadb` driver for backups; `verify` also needs `mariadb-install-db`/`mariadbd` on PATH or in `MARIADB_BIN` unless `--restore-url` is given):

| Command | Does |
| --- | --- |
| `npm run backup:db -- --url "$DATABASE_URL" --out /secure/backups` | Read-only. One `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY` reads schema, rows, sequences and triggers, so concurrent exam writes cannot tear it. Writes a plain-SQL dump (`DELIMITER ;;`, also restorable with the `mariadb` client), a SHA-256, and a manifest with per-table row counts and content fingerprints (SHA-256 over the rows in primary-key order) computed from the **same rows**. Output is explicitly labelled *NOT verified*. Measured 2026-11-04 on the Hostinger demo database: 10.5 MB, 44 tables, 35,327 rows, verified. |
| `npm run backup:verify -- --backup /secure/backups/oes-<ts>.sql` | Restores into a **disposable** MariaDB server (temp dir, random localhost port; never a shared server), or into `--restore-url`, which must name an **empty** database other than the source. Then checks: file checksum · every statement restores · every table's count + fingerprint equals the manifest (and no extra tables) · sequences present · migration history identical · append-only/answer-lock triggers present · `audit_logs` still rejects UPDATE. Exit 0 = verified, 1 = failed, 2 = usage. `--keep` leaves the restored server running and prints its URL (for the application-level check below). |

**Acceptance rule:** a backup is *operational* only after `backup:verify` has exited 0 for that file. Keep the `.sql`, `.sha256` and `.manifest.json` together.

## Tests (`npm run test:fault`, file `backup-restore.test.ts`)
`apps/api/test-fault/` still drives disposable **PostgreSQL** clusters (written before the 2026-11-04 move to MariaDB) and has not been ported; the MariaDB script above was checked by hand: verified restore of the live demo database, and a one-byte change to the dump ⇒ checksum failure (exit 1).

## Restoring for real (disaster recovery)
1. Run `backup:verify` on the chosen backup first (it will still pass/fail the same way).
2. Provision an empty MariaDB 11.x database (Hostinger: hPanel → Databases → MySQL) and user.
3. `mariadb --host … --user … -p NEW_DB < oes-<ts>.sql` (or `backup:verify --restore-url mysql://…/NEW_DB --keep`, which restores and checks it in one step). Hostinger's own daily backups (hPanel → Files → Backups) are a second, independent copy.
4. Point `DATABASE_URL` at it, start the API (`prisma migrate deploy` must report nothing to apply), call `GET /api/audit/verify` as CCE/Super Admin (expect `brokenAt: null`), flush Redis (it holds only caches and password-reset tokens).
5. Record the incident, the backup id used, and the data window lost (see RPO).

## Gaps (honest)
- **RPO = backup interval.** Logical dumps only; anything after the last backup is lost. For exam days run a backup immediately before opening and after closing. Shared Hostinger hosting offers no binlog access, so point-in-time recovery needs a database host that does.
- **No encryption.** Dumps contain personal data and answer keys. Encrypt before they leave the host (e.g. `age`/GPG) and restrict the directory; key custody is a policy decision (P-19 / security doc).
- **Not scheduled, not shipped off-site, retention not enforced.** A scheduler (cron/CronJob), off-site copy and a retention/rotation policy are required.
- **Not measured at scale.** Fingerprinting and restore time have only been run on the ~500-row synthetic data set. RTO for a 20,000-candidate database is unknown; measure with a production-size synthetic database.
- Redis is deliberately excluded (cache + reset tokens only).
- Restore verification proves the dump is restorable and complete on the MariaDB version installed locally, not that a different server version behaves identically.
