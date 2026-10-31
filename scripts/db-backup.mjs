#!/usr/bin/env node
/**
 * Verifiable PostgreSQL backup & restore verification for the OES database.
 *
 *   node scripts/db-backup.mjs backup --url postgresql://… --out /backups/dir
 *   node scripts/db-backup.mjs verify --backup /backups/dir/oes-<ts>.dump [--keep]
 *
 * backup  : consistent snapshot (pg_export_snapshot + pg_dump --snapshot), custom-format dump, SHA-256, and a manifest holding
 *           per-table row counts + content fingerprints computed on the SAME snapshot.
 * verify  : restores the dump into a DISPOSABLE PostgreSQL cluster (temp dir, random localhost port — never a shared server),
 *           then checks checksum, every table's count + fingerprint, migration history and the integrity triggers.
 *           A backup is only "verified" when this exits 0. Exit codes: 0 ok · 1 verification failed · 2 usage/tooling error.
 * Read-only against the source. Does not print passwords.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg');
const PG_BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
const isRoot = process.getuid?.() === 0;
const FINGERPRINT = (t) => `SELECT count(*)::bigint AS n, coalesce(sum((('x' || substr(md5(t::text), 1, 15))::bit(60)::bigint)::numeric), 0)::text AS fp FROM ${t} t`;
const INTEGRITY_TRIGGERS = ['audit_logs_append_only', 'answer_events_append_only', 'attempt_answers_lock', 'exam_roster_versions_append_only', 'eligibility_overrides_append_only'];

const args = Object.fromEntries(process.argv.slice(3).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]] : a), []));
const die = (code, msg) => { console.error(msg); process.exit(code); };
const redact = (u) => u.replace(/:\/\/([^:@/]+):[^@]*@/, '://$1:***@');
const sha256File = (f) => new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const asPg = (cmd, a) => (isRoot ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...a], { stdio: 'pipe' }) : execFileSync(cmd, a, { stdio: 'pipe' }));

async function tables(client) {
  const r = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  return r.rows.map((x) => x.tablename);
}
async function fingerprints(client) {
  const out = {};
  for (const t of await tables(client)) { const r = await client.query(FINGERPRINT(`"${t}"`)); out[t] = { rows: Number(r.rows[0].n), fingerprint: r.rows[0].fp }; }
  return out;
}

async function backup() {
  const url = args.url ?? process.env.DATABASE_URL; const out = args.out;
  if (!url || !out || out === true) die(2, 'usage: backup --url <DATABASE_URL> --out <dir>');
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dump = path.join(out, `oes-${stamp}.dump`);
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); await c.query(`SET TIME ZONE 'UTC'`);
    const snap = (await c.query('SELECT pg_export_snapshot() AS s')).rows[0].s;       // dump & fingerprints see the same instant
    const fps = await fingerprints(c);
    const mig = (await c.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).rows.map((r) => r.migration_name);
    const server = (await c.query('SHOW server_version')).rows[0].server_version;
    execFileSync(`${PG_BIN}/pg_dump`, ['--format=custom', '--compress=6', '--no-owner', `--snapshot=${snap}`, `--file=${dump}`, url], { stdio: 'pipe' });
    await c.query('COMMIT');
    const manifest = { createdAt: new Date().toISOString(), source: redact(url), serverVersion: server, pgDump: execFileSync(`${PG_BIN}/pg_dump`, ['--version']).toString().trim(), dump: path.basename(dump), bytes: statSync(dump).size, sha256: await sha256File(dump), migrations: mig, tables: fps };
    writeFileSync(`${dump}.manifest.json`, JSON.stringify(manifest, null, 2));
    writeFileSync(`${dump}.sha256`, `${manifest.sha256}  ${manifest.dump}\n`);
    const total = Object.values(fps).reduce((n, t) => n + t.rows, 0);
    console.log(JSON.stringify({ ok: true, dump, bytes: manifest.bytes, sha256: manifest.sha256, tables: Object.keys(fps).length, rows: total, note: 'NOT verified until `verify` has restored it' }));
  } finally { await c.end().catch(() => undefined); }
}

async function verify() {
  const dump = args.backup; if (!dump || dump === true || !existsSync(dump)) die(2, 'usage: verify --backup <file.dump> [--keep]');
  const mf = `${dump}.manifest.json`; if (!existsSync(mf)) die(2, `missing manifest ${mf}`);
  const manifest = JSON.parse(readFileSync(mf, 'utf8'));
  const report = { backup: dump, checks: {}, problems: [] };
  const fail = (m) => { report.problems.push(m); };
  // 1. file integrity
  const actual = await sha256File(dump);
  report.checks.checksum = actual === manifest.sha256; if (!report.checks.checksum) { fail(`checksum mismatch (expected ${manifest.sha256}, got ${actual}) — backup file is corrupt or tampered`); finish(report); }
  // 2. restore into a disposable cluster
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oes-restore-')); chmodSync(dir, 0o755);
  if (isRoot) execFileSync('chown', ['postgres:postgres', dir]);
  const sock = path.join(dir, 'sock'); mkdirSync(sock, { mode: 0o777 }); if (isRoot) execFileSync('chown', ['postgres:postgres', sock]);
  const port = await freePort(); const data = path.join(dir, 'data'); let started = false;
  const url = `postgresql://oes@127.0.0.1:${port}/restored`;
  const stop = () => { if (started) try { asPg(`${PG_BIN}/pg_ctl`, ['-D', data, '-m', 'fast', '-w', 'stop']); started = false; } catch { /* ignore */ } };
  try {
    asPg(`${PG_BIN}/initdb`, ['-D', data, '-U', 'oes', '--auth=trust', '-E', 'UTF8', '--locale=C']);
    asPg(`${PG_BIN}/pg_ctl`, ['-D', data, '-l', path.join(dir, 'pg.log'), '-w', '-t', '60', '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${sock}`, 'start']); started = true;
    const admin = new pg.Client({ connectionString: `postgresql://oes@127.0.0.1:${port}/postgres` }); await admin.connect(); await admin.query('CREATE DATABASE restored'); await admin.end();
    execFileSync(`${PG_BIN}/pg_restore`, ['--exit-on-error', '--no-owner', `--dbname=${url}`, dump], { stdio: 'pipe' });
    report.checks.restore = true;
    // 3. content comparison with the manifest (taken on the same snapshot as the dump)
    const c = new pg.Client({ connectionString: url }); await c.connect(); await c.query(`SET TIME ZONE 'UTC'`);
    const fps = await fingerprints(c);
    report.checks.tables = Object.keys(manifest.tables).length;
    for (const [t, exp] of Object.entries(manifest.tables)) {
      const got = fps[t];
      if (!got) fail(`table ${t} missing after restore`);
      else if (got.rows !== exp.rows) fail(`table ${t}: ${got.rows} rows restored, ${exp.rows} expected`);
      else if (got.fingerprint !== exp.fingerprint) fail(`table ${t}: content fingerprint differs`);
    }
    for (const t of Object.keys(fps)) if (!(t in manifest.tables)) fail(`unexpected extra table ${t}`);
    report.checks.contentMatches = report.problems.length === 0;
    // 4. migration history
    const mig = (await c.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).rows.map((r) => r.migration_name);
    report.checks.migrations = JSON.stringify(mig) === JSON.stringify(manifest.migrations); if (!report.checks.migrations) fail('migration history differs');
    // 5. integrity machinery survived the round trip
    const trg = new Set((await c.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).rows.map((r) => r.tgname));
    const missing = INTEGRITY_TRIGGERS.filter((t) => !trg.has(t)); report.checks.triggers = missing.length === 0; if (missing.length) fail(`integrity triggers missing: ${missing.join(', ')}`);
    const hasAudit = (await c.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n > 0;
    let blocked = false; let probeError = null;
    if (hasAudit) { try { await c.query(`UPDATE audit_logs SET action = action WHERE ctid = (SELECT ctid FROM audit_logs LIMIT 1)`); } catch (e) { if (/append-only/.test(String(e.message))) blocked = true; else probeError = String(e.message); } }
    report.checks.auditAppendOnly = !hasAudit || blocked;
    if (probeError) fail(`append-only probe could not run: ${probeError}`); else if (hasAudit && !blocked) fail('audit_logs is mutable after restore');
    await c.end();
    report.restoredUrl = args.keep ? url : undefined; report.dataDir = args.keep ? data : undefined;
  } catch (e) {
    fail(`restore failed: ${String(e.stderr ?? e.message).slice(0, 400)}`);
  } finally {
    if (!args.keep) { stop(); rmSync(dir, { recursive: true, force: true }); }
  }
  finish(report);
}

function finish(report) {
  report.ok = report.problems.length === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

const cmd = process.argv[2];
if (cmd === 'backup') await backup();
else if (cmd === 'verify') await verify();
else die(2, 'usage: db-backup.mjs <backup|verify> …');
