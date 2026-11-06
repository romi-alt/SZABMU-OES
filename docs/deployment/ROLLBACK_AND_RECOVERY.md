# Rollback and recovery

Applies to the Hostinger single-site deployment (`scripts/hostinger-single-site.mjs`, auto-deploy from `main`, MariaDB on the same server).
Golden rules: **never delete or rewrite examination data to "fix" a release; never run `prisma migrate reset` or the seed against a real database;
prefer rolling the code back over touching the database.**

## 1. Before every release
1. All gates green on the release commit (`IMPLEMENTATION_TRACKER.md` §3 commands) and CI green.
2. Take a verified backup: `node scripts/db-backup.mjs backup --url "$DATABASE_URL" --out <dir>` then `node scripts/db-backup.mjs verify --backup <dir>/oes-<ts>.sql`
   (exit 0 = restored in a disposable server and matched). Store the dump and its manifest off the server.
3. Read every new migration: it must be **additive** (new tables/columns/indexes with defaults). A migration that drops, renames or rewrites data
   needs a separate written plan and approval.
4. No release while an examination is LIVE or SUSPENDED (check the exam control page); auto-deploy restarts the only process.

## 2. Rolling back code (most incidents)
1. On GitHub, revert the merge commit on `main` (a new "Revert …" commit; never force-push `main`). Hostinger rebuilds automatically (~2 min).
2. Additive migrations stay applied; older code ignores new columns/tables. **Do not** try to undo them. Exception noted in a release: a new enum
   value already stored (e.g. a role) may be unknown to older code — check the release notes.
3. Verify: `GET /api/health` → `status ok, db true`; sign in on both portals with a known account; open My Examinations; open the exam control page.

## 3. During a live examination
- A broken release must not be deployed mid-exam. If the platform misbehaves: **suspend** the affected scope from the control page
  (FREEZE_CLOCK keeps everyone's remaining time), fix or roll back between exams, then **resume**; deadlines shift by the paused time.
- If the process restarts, nothing is lost: answers are committed per save; the reconciler seals expired attempts exactly once when it runs again.
- Extensions are idempotent (same key → applied once); use them for candidates affected by an outage.

## 4. Database recovery (last resort, needs approval)
1. Stop writes (put the site in maintenance or stop the Node.js application in hPanel).
2. Restore the last verified dump into a **new, empty** database first: `node scripts/db-backup.mjs verify --backup <dump> --restore-url mysql://…/empty_db` and inspect it.
3. Only then switch `DATABASE_URL` to it (hPanel environment variables, full replace) and restart. Keep the damaged database untouched for investigation.
4. Answers written after the backup are not in it: reconcile from the incident timeline before publishing any result.

## 5. Not yet rehearsed
None of §2–§4 has been rehearsed on production (checklist A11, A12). Until they are, treat these steps as a plan, not a proven procedure.
