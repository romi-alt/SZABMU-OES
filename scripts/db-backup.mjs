#!/usr/bin/env node
/**
 * Verifiable MySQL/MariaDB backup & restore verification for the OES database.
 *
 *   node scripts/db-backup.mjs backup --url mysql://… --out /backups/dir
 *   node scripts/db-backup.mjs verify --backup /backups/dir/oes-<ts>.sql [--keep] [--restore-url mysql://…/empty_db]
 *
 * backup  : one READ ONLY transaction WITH CONSISTENT SNAPSHOT reads every table, writes the dump (schema, data, sequences,
 *           triggers) and, from the SAME rows, a manifest with per-table counts + content fingerprints, plus a SHA-256.
 *           The dump is plain SQL with `DELIMITER ;;` — it also restores with `mariadb db < file.sql`.
 * verify  : restores the dump into a DISPOSABLE MariaDB server (temp dir, random localhost port; binaries from MARIADB_BIN or
 *           PATH — never a shared server) or into --restore-url, which must name an EMPTY database. Then checks checksum,
 *           every table's count + fingerprint, migration history, the integrity triggers and that audit_logs is still append-only.
 *           A backup is only "verified" when this exits 0. Exit codes: 0 ok · 1 verification failed · 2 usage/tooling error.
 * Read-only against the source. Does not print passwords.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import mariadb from 'mariadb';

const SEP = '\n;;\n';
const INTEGRITY_TRIGGERS = ['audit_logs_no_update', 'audit_logs_no_delete', 'answer_events_no_update', 'answer_events_no_delete', 'attempt_answers_lock_ins',
  'attempt_answers_lock_upd', 'attempt_answers_lock_del', 'exam_roster_versions_no_update', 'eligibility_overrides_no_update', 'exam_events_guard', 'exam_events_no_delete'];
const args = Object.fromEntries(process.argv.slice(3).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]] : a), []));
const die = (code, msg) => { console.error(msg); process.exit(code); };
const redact = (u) => u.replace(/:\/\/([^:@/]+):[^@]*@/, '://$1:***@');
const sha256File = (f) => new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const q = (id) => `\`${id.replace(/`/g, '``')}\``;

function connect(url, extra = {}) {
  const u = new URL(url); const accept = u.searchParams.get('sslaccept');
  if (!/^(mysql|mariadb):$/.test(u.protocol)) die(2, 'URL must be mysql://…');
  return mariadb.createConnection({
    host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)) || undefined, ssl: accept ? { rejectUnauthorized: accept === 'strict' } : undefined,
    connectTimeout: 20_000, dateStrings: true, autoJsonMap: false, bigIntAsNumber: false, decimalAsNumber: false, supportBigNumbers: true, bigNumberStrings: true,
    initSql: ["SET time_zone = '+00:00'"], multipleStatements: false, ...extra,
  });
}
/** Canonical, type-stable text of one value (identical whether read from the source or the restored copy). */
const canon = (v) => (v === null || v === undefined ? null : Buffer.isBuffer(v) ? `x${v.toString('hex')}` : typeof v === 'bigint' ? v.toString() : String(v));
const literal = (conn, v) => (v === null || v === undefined ? 'NULL' : Buffer.isBuffer(v) ? `X'${v.toString('hex')}'` : typeof v === 'number' || typeof v === 'bigint' ? String(v) : conn.escape(String(v)));

async function catalog(conn) {
  const objs = await conn.query("SELECT table_name t, table_type k FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name");
  const cols = new Map(); const pks = new Map();
  for (const r of await conn.query("SELECT table_name t, column_name c, extra e, column_key k FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position")) {
    if (!cols.has(r.t)) { cols.set(r.t, []); pks.set(r.t, []); }
    if (!/GENERATED/i.test(r.e)) cols.get(r.t).push(r.c);   // generated columns are recomputed on restore
    if (r.k === 'PRI') pks.get(r.t).push(r.c);
  }
  return { tables: objs.filter((o) => o.k === 'BASE TABLE').map((o) => o.t), sequences: objs.filter((o) => o.k === 'SEQUENCE').map((o) => o.t), cols, pks };
}
async function* tableRows(conn, t, cat) {
  const cols = cat.cols.get(t); const pk = cat.pks.get(t).length ? cat.pks.get(t) : cols;
  const stream = conn.queryStream({ sql: `SELECT ${cols.map(q).join(',')} FROM ${q(t)} ORDER BY ${pk.map(q).join(',')}`, rowsAsArray: true });
  for await (const row of stream) yield row;
}
async function fingerprints(conn, cat, onRow) {
  const out = {};
  for (const t of cat.tables) {
    const h = createHash('sha256'); let n = 0;
    for await (const row of tableRows(conn, t, cat)) { h.update(JSON.stringify(row.map(canon))); h.update('\n'); n++; await onRow?.(t, row); }
    out[t] = { rows: n, fingerprint: h.digest('hex') };
  }
  return out;
}
const migrations = async (conn) => (await conn.query('SELECT migration_name m FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name').catch(() => [])).map((r) => r.m);

async function backup() {
  const url = args.url ?? process.env.DATABASE_URL; const out = args.out;
  if (!url || url === true || !out || out === true) die(2, 'usage: backup --url <DATABASE_URL> --out <dir>');
  mkdirSync(out, { recursive: true });
  const dump = path.join(out, `oes-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
  const c = await connect(url); const file = createWriteStream(dump, { encoding: 'utf8' });
  const write = (s) => new Promise((res) => (file.write(s) ? res() : file.once('drain', res)));
  try {
    await c.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');   // every SELECT below sees the same instant
    const cat = await catalog(c);
    const server = (await c.query('SELECT VERSION() v'))[0].v;
    await write(`-- OES backup ${new Date().toISOString()} from ${redact(url)} (MariaDB ${server})\nDELIMITER ;;\nSET NAMES utf8mb4${SEP}SET time_zone = '+00:00'${SEP}SET FOREIGN_KEY_CHECKS = 0${SEP}SET UNIQUE_CHECKS = 0${SEP}SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES'${SEP}`);
    for (const t of cat.tables) await write(`${(await c.query(`SHOW CREATE TABLE ${q(t)}`))[0]['Create Table']}${SEP}`);
    for (const s of cat.sequences) {
      await write(`${(await c.query(`SHOW CREATE SEQUENCE ${q(s)}`))[0]['Create Table']}${SEP}`);
      const next = (await c.query(`SELECT next_not_cached_value n FROM ${q(s)}`))[0].n;
      await write(`DO SETVAL(${q(s)}, ${BigInt(next) - 1n}, 1)${SEP}`);
    }
    let batch = []; let cur = null;
    const flush = async () => { if (batch.length) await write(`INSERT INTO ${q(cur)} (${cat.cols.get(cur).map(q).join(',')}) VALUES\n${batch.join(',\n')}${SEP}`); batch = []; };
    const fps = await fingerprints(c, cat, async (t, row) => {
      if (t !== cur) { await flush(); cur = t; }
      batch.push(`(${row.map((v) => literal(c, v)).join(',')})`); if (batch.length >= 500) await flush();
    });
    await flush();
    for (const tr of await c.query("SELECT trigger_name n FROM information_schema.triggers WHERE trigger_schema = DATABASE() ORDER BY trigger_name")) {
      await write(`${(await c.query(`SHOW CREATE TRIGGER ${q(tr.n)}`))[0]['SQL Original Statement'].replace(/^CREATE\s+DEFINER\s*=\s*\S+\s+TRIGGER/i, 'CREATE TRIGGER')}${SEP}`);
    }
    await write(`SET FOREIGN_KEY_CHECKS = 1${SEP}SET UNIQUE_CHECKS = 1${SEP}DELIMITER ;\n`);
    const mig = await migrations(c);
    await c.query('COMMIT');
    await new Promise((res, rej) => file.end((e) => (e ? rej(e) : res())));
    const manifest = { createdAt: new Date().toISOString(), source: redact(url), serverVersion: server, dump: path.basename(dump), bytes: statSync(dump).size, sha256: await sha256File(dump), migrations: mig, sequences: cat.sequences, tables: fps };
    writeFileSync(`${dump}.manifest.json`, JSON.stringify(manifest, null, 2));
    writeFileSync(`${dump}.sha256`, `${manifest.sha256}  ${manifest.dump}\n`);
    const total = Object.values(fps).reduce((n, t) => n + t.rows, 0);
    console.log(JSON.stringify({ ok: true, dump, bytes: manifest.bytes, sha256: manifest.sha256, tables: Object.keys(fps).length, rows: total, note: 'NOT verified until `verify` has restored it' }));
  } finally { file.destroyed || file.end(); await c.end().catch(() => undefined); }
}

/** A throw-away MariaDB server in a temp dir on a random localhost port. */
async function disposableServer(dir) {
  const bin = process.env.MARIADB_BIN; const exe = (n) => (bin ? path.join(bin, n + (process.platform === 'win32' ? '.exe' : '')) : n);
  const data = path.join(dir, 'data'); const port = await freePort();
  execFileSync(exe('mariadb-install-db'), [`--datadir=${data}`, ...(process.platform === 'win32' ? ['--password=restore'] : ['--auth-root-authentication-method=normal', '--skip-test-db'])], { stdio: 'pipe' });
  const proc = spawn(exe('mariadbd'), [`--datadir=${data}`, `--port=${port}`, '--bind-address=127.0.0.1', '--skip-networking=0', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci',
    ...(process.platform === 'win32' ? [] : [`--socket=${path.join(dir, 'sock')}`, '--skip-grant-tables=0'])], { stdio: 'ignore' });
  const pw = process.platform === 'win32' ? 'restore' : '';
  for (let i = 0; i < 120; i++) {
    try { const a = await mariadb.createConnection({ host: '127.0.0.1', port, user: 'root', password: pw, connectTimeout: 2000 }); await a.query('CREATE DATABASE restored'); await a.end(); break; } catch (e) { if (i === 119) throw e; await new Promise((r) => setTimeout(r, 500)); }
  }
  return { url: `mysql://root:${pw}@127.0.0.1:${port}/restored`, data, stop: () => { try { proc.kill(); } catch { /* gone */ } } };
}

async function verify() {
  const dump = args.backup; if (!dump || dump === true || !existsSync(dump)) die(2, 'usage: verify --backup <file.sql> [--keep] [--restore-url <empty db>]');
  const mf = `${dump}.manifest.json`; if (!existsSync(mf)) die(2, `missing manifest ${mf}`);
  const manifest = JSON.parse(readFileSync(mf, 'utf8'));
  const report = { backup: dump, checks: {}, problems: [] };
  const fail = (m) => { report.problems.push(m); };
  // 1. file integrity
  const actual = await sha256File(dump);
  report.checks.checksum = actual === manifest.sha256; if (!report.checks.checksum) { fail(`checksum mismatch (expected ${manifest.sha256}, got ${actual}) — backup file is corrupt or tampered`); finish(report); }
  // 2. restore into a disposable server (or an explicitly given EMPTY database)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oes-restore-')); let server = null; let url = args['restore-url'];
  try {
    if (url && url !== true) {
      if (redact(url) === manifest.source) die(2, 'refusing: --restore-url is the backup source');
      const probe = await connect(url); const n = Number((await probe.query('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE()'))[0].n); await probe.end();
      if (n > 0) die(2, `refusing: --restore-url database is not empty (${n} tables)`);
    } else { server = await disposableServer(dir); url = server.url; }
    const c = await connect(url);
    const body = readFileSync(dump, 'utf8').replace(/^[\s\S]*?DELIMITER ;;\n/, '').replace(/\nDELIMITER ;\n?$/, '\n');
    for (const stmt of body.split(SEP)) if (stmt.trim()) await c.query(stmt);
    report.checks.restore = true;
    // 3. content comparison with the manifest (taken on the same snapshot as the dump)
    await c.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ'); await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const cat = await catalog(c); const fps = await fingerprints(c, cat); await c.query('COMMIT');
    report.checks.tables = Object.keys(manifest.tables).length;
    for (const [t, exp] of Object.entries(manifest.tables)) {
      const got = fps[t];
      if (!got) fail(`table ${t} missing after restore`);
      else if (got.rows !== exp.rows) fail(`table ${t}: ${got.rows} rows restored, ${exp.rows} expected`);
      else if (got.fingerprint !== exp.fingerprint) fail(`table ${t}: content fingerprint differs`);
    }
    for (const t of Object.keys(fps)) if (!(t in manifest.tables)) fail(`unexpected extra table ${t}`);
    for (const s of manifest.sequences ?? []) if (!cat.sequences.includes(s)) fail(`sequence ${s} missing after restore`);
    report.checks.contentMatches = report.problems.length === 0;
    // 4. migration history
    report.checks.migrations = JSON.stringify(await migrations(c)) === JSON.stringify(manifest.migrations); if (!report.checks.migrations) fail('migration history differs');
    // 5. integrity machinery survived the round trip
    const trg = new Set((await c.query('SELECT trigger_name n FROM information_schema.triggers WHERE trigger_schema = DATABASE()')).map((r) => r.n));
    const missing = INTEGRITY_TRIGGERS.filter((t) => manifest.tables[t.replace(/_(no_update|no_delete|lock_ins|lock_upd|lock_del|guard)$/, '')] && !trg.has(t));
    report.checks.triggers = missing.length === 0; if (missing.length) fail(`integrity triggers missing: ${missing.join(', ')}`);
    const hasAudit = (manifest.tables.audit_logs?.rows ?? 0) > 0; let blocked = false; let probeError = null;
    if (hasAudit) { try { await c.query('UPDATE audit_logs SET action = action LIMIT 1'); } catch (e) { if (/append-only/.test(String(e.message))) blocked = true; else probeError = String(e.message); } }
    report.checks.auditAppendOnly = !hasAudit || blocked;
    if (probeError) fail(`append-only probe could not run: ${probeError}`); else if (hasAudit && !blocked) fail('audit_logs is mutable after restore');
    await c.end();
    report.restoredUrl = args.keep ? redact(url) : undefined; report.dataDir = args.keep && server ? server.data : undefined;
  } catch (e) {
    fail(`restore failed: ${String(e.stderr ?? e.message).slice(0, 400)}`);
  } finally {
    if (!args.keep) { server?.stop(); await new Promise((r) => setTimeout(r, 1500)); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
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
