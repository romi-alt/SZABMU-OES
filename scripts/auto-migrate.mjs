/**
 * Applies PENDING Prisma migrations when the site starts (Hostinger managed hosting has no shell and no deploy hook for it).
 *
 * Safe by construction:
 *  - `prisma migrate deploy` only runs migration files already committed to the repository, in order, once each; it never resets, drops or "fixes" data.
 *    (Every migration in this repository is additive; `migrate dev` / `migrate reset` are never used here.)
 *  - It is a no-op when nothing is pending, and Prisma holds a database lock (GET_LOCK on MySQL/MariaDB) so two starting processes cannot apply a migration twice.
 *  - Hostinger MariaDB has a single endpoint, so DATABASE_URL is used as is. (Managed PostgreSQL such as Neon offered a pooled endpoint ("-pooler" in the host name) that cannot hold the advisory lock; the migration is run on the DIRECT
 *    endpoint, derived by removing "-pooler"); MIGRATE_DATABASE_URL overrides it when set.
 *  - A failure is logged loudly and does NOT crash the launcher (the health endpoint stays reachable so the cause can be read from the logs).
 *  - Disable with AUTO_MIGRATE=false.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

export const directUrl = (url) => (process.env.MIGRATE_DATABASE_URL || String(url).replace(/-pooler(\.[^/@:]+)/, '$1'));

export function autoMigrate(root, log = console.error) {
  if (process.env.AUTO_MIGRATE === 'false') { log('[migrate] AUTO_MIGRATE=false — skipped'); return 'skipped'; }
  const url = process.env.DATABASE_URL;
  if (!url) { log('[migrate] no DATABASE_URL — skipped'); return 'skipped'; }
  try {
    const require = createRequire(path.join(root, 'apps/api/package.json'));
    const cli = require.resolve('prisma/build/index.js');
    const started = Date.now();
    const out = execFileSync(process.execPath, [cli, 'migrate', 'deploy'], { cwd: path.join(root, 'apps/api'), env: { ...process.env, DATABASE_URL: directUrl(url) }, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const applied = /have been successfully applied|applied/i.test(out) && !/No pending migrations/i.test(out);
    log(`[migrate] ${applied ? 'applied pending migrations' : 'database already up to date'} (${Date.now() - started} ms)`);
    return applied ? 'applied' : 'up-to-date';
  } catch (e) {
    const detail = String(e.stderr || e.stdout || e.message).split('\n').filter(Boolean).slice(-6).join(' | ');
    log(`[migrate] FAILED — the database may be missing recent changes: ${detail}`);
    return 'failed';
  }
}
