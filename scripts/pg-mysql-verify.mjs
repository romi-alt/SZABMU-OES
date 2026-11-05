#!/usr/bin/env node
/**
 * Verifies a pg-to-mysql.mjs copy value by value: every row of every application table is read from both databases, normalised
 * (timestamps to ISO milliseconds, JSON parsed, booleans, bigints) and compared by primary key. Same env vars as pg-to-mysql.mjs.
 *   SOURCE_DATABASE_URL=… DATABASE_URL=… node scripts/pg-mysql-verify.mjs
 */
import pg from 'pg';
import mariadb from 'mariadb';

const SRC = process.env.SOURCE_DATABASE_URL; const DST = process.env.DATABASE_URL;
if (!SRC || !DST) throw new Error('SOURCE_DATABASE_URL and DATABASE_URL are required');
const u = new URL(DST); const q = u.searchParams.get('sslaccept');
const my = await mariadb.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: q ? { rejectUnauthorized: q === 'strict' } : undefined, initSql: ["SET time_zone = '+00:00'"], dateStrings: true, bigIntAsNumber: true, decimalAsNumber: true, connectTimeout: 20000 });
const src = new pg.Client({ connectionString: SRC }); await src.connect(); await src.query("SET TIME ZONE 'UTC'");

const canon = (v) => v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
const norm = (v, type) => {
  if (v === null || v === undefined) return null;
  if (type === 'datetime') return new Date(String(v).replace(' ', 'T') + 'Z').toISOString();
  if (type === 'date') return String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString('hex');
  if (type === 'longtext') return JSON.stringify(canon(typeof v === 'string' ? JSON.parse(v) : v));
  if (type === 'tinyint') return Boolean(Number(v));
  if (typeof v === 'boolean') return v;
  if (['int', 'bigint', 'double', 'float'].includes(type)) return Number(v);
  return String(v);
};
const skip = new Set(['_prisma_migrations', 'app_locks', 'lifecycle_runs', 'lifecycle_leases', 'certificate_serial_seq']);   // operational rows the live site keeps rewriting, and the sequence object
try {
  const cols = new Map(); const pks = new Map();
  for (const r of await my.query("SELECT table_name t, column_name c, data_type d, extra e, column_key k FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY ordinal_position")) {
    if (/GENERATED/i.test(r.e) || skip.has(r.t)) continue;
    if (!cols.has(r.t)) { cols.set(r.t, new Map()); pks.set(r.t, []); }
    cols.get(r.t).set(r.c, r.d); if (r.k === 'PRI') pks.get(r.t).push(r.c);
  }
  let bad = 0; const out = [];
  for (const [t, c] of cols) {
    const names = [...c.keys()]; const pk = pks.get(t);
    const key = (r) => pk.map((k) => String(r[k])).join('|');
    const a = new Map((await src.query(`SELECT * FROM "${t}"`)).rows.map((r) => [key(r), r]));
    const b = new Map((await my.query(`SELECT * FROM \`${t}\``)).map((r) => [key(r), r]));
    let diff = 0; let firstDiff = '';
    for (const [k, ra] of a) {
      const rb = b.get(k); if (!rb) { diff++; firstDiff ||= `missing ${k}`; continue; }
      for (const n of names) {
        const x = norm(ra[n], c.get(n) === 'datetime' || c.get(n) === 'date' ? 'pgdate' : c.get(n)); const y = norm(rb[n], c.get(n));
        const xa = c.get(n) === 'datetime' ? (ra[n] ? new Date(ra[n]).toISOString() : null) : c.get(n) === 'date' ? (ra[n] ? new Date(ra[n]).toISOString().slice(0, 10) : null) : x;
        if (JSON.stringify(xa) !== JSON.stringify(y)) { diff++; firstDiff ||= `${k}.${n}: ${JSON.stringify(xa)} ≠ ${JSON.stringify(y)}`; break; }
      }
    }
    if (b.size !== a.size) { diff++; firstDiff ||= `size ${a.size} vs ${b.size}`; }
    bad += diff; out.push({ table: t, rows: a.size, mismatched: diff, ...(firstDiff ? { first: firstDiff.slice(0, 120) } : {}) });
  }
  console.table(out);
  if (bad) { console.error(`${bad} mismatching rows`); process.exitCode = 1; } else console.log('Every row and every value matches.');
} finally { await src.end(); await my.end(); }
