#!/usr/bin/env node
/**
 * One-off data copy: PostgreSQL (the old Neon database) → MySQL/MariaDB (Hostinger), after `npm run db:migrate` has created the
 * MySQL schema. Copies every application table row-for-row (ids, timestamps and hashes unchanged, so the audit hash chain and
 * receipts still verify), then moves the certificate serial sequence past the copied value.
 *
 *   SOURCE_DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' \
 *   DATABASE_URL='mysql://user:pass@srv1774.hstgr.io:3306/db?sslaccept=strict' \
 *   node scripts/pg-to-mysql.mjs [--replace]
 *
 * Refuses to write into a target that already holds application data unless --replace is given (then the target tables are emptied first).
 * Stop writes to the source (or accept losing anything written during the copy) before running it for the final cut-over.
 */
import pg from 'pg';
import mariadb from 'mariadb';

const SRC = process.env.SOURCE_DATABASE_URL; const DST = process.env.DATABASE_URL;
if (!SRC || !/^postgres/.test(SRC)) throw new Error('SOURCE_DATABASE_URL must be the PostgreSQL URL');
if (!DST || !/^(mysql|mariadb):/.test(DST)) throw new Error('DATABASE_URL must be the mysql:// URL');
const replace = process.argv.includes('--replace');

// Parents before children (FK order); generated columns (correctFlag, activeKey) are computed by MySQL and never copied.
const TABLES = ['institutions', 'departments', 'programs', 'courses', 'users', 'user_institutions', 'sessions', 'password_resets', 'password_history',
  'mfa_recovery_codes', 'roster_entries', 'students', 'enrollments', 'questions', 'question_options', 'exams', 'exam_institutions', 'exam_questions',
  'exam_candidates', 'exam_invigilators', 'exam_roster_versions', 'attempts', 'attempt_answers', 'answer_events', 'attempt_events', 'incidents',
  'incident_notes', 'key_actions', 'result_batches', 'results', 'certificates', 'notifications', 'outbound_messages', 'audit_logs',
  'eligibility_overrides', 'course_assignments', 'exam_suspensions', 'exam_extensions', 'exam_commands', 'exam_events', 'lifecycle_leases', 'lifecycle_runs'];
// The answer-lock triggers refuse answers for finalised attempts, which is exactly what copying history inserts; they are recreated after.
const ANSWER_TRIGGERS = ['ins', 'upd', 'del'].map((k) => ({ name: `attempt_answers_lock_${k}`, timing: k === 'ins' ? 'INSERT' : k === 'upd' ? 'UPDATE' : 'DELETE', row: k === 'ins' ? 'NEW' : 'OLD' }));

const u = new URL(DST); const q = u.searchParams.get('sslaccept');
const my = await mariadb.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), ssl: q ? { rejectUnauthorized: q === 'strict' } : undefined, initSql: ["SET time_zone = '+00:00'"], connectTimeout: 20000 });
const src = new pg.Client({ connectionString: SRC }); await src.connect();
await src.query("SET TIME ZONE 'UTC'");

const pad = (n, z = 2) => String(n).padStart(z, '0');
const dt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;

try {
  const myCols = new Map();
  for (const r of await my.query("SELECT table_name t, column_name c, data_type d, extra e FROM information_schema.columns WHERE table_schema = DATABASE()")) {
    if (/GENERATED/i.test(r.e)) continue;
    if (!myCols.has(r.t)) myCols.set(r.t, new Map()); myCols.get(r.t).set(r.c, r.d);
  }
  const missing = TABLES.filter((t) => !myCols.has(t)); if (missing.length) throw new Error(`target is missing tables (run db:migrate first): ${missing}`);
  const nonEmpty = [];
  for (const t of TABLES) if (Number((await my.query(`SELECT COUNT(*) n FROM \`${t}\``))[0].n) > 0) nonEmpty.push(t);
  if (nonEmpty.length && !replace) throw new Error(`target already has data in ${nonEmpty.join(', ')} — pass --replace to empty and overwrite it`);

  await my.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const tr of ANSWER_TRIGGERS) await my.query(`DROP TRIGGER IF EXISTS \`${tr.name}\``);
  if (replace) for (const t of TABLES) await my.query(`TRUNCATE TABLE \`${t}\``);   // TRUNCATE bypasses the append-only DELETE triggers

  const report = [];
  for (const t of TABLES) {
    const cols = myCols.get(t); const names = [...cols.keys()];
    const { rows } = await src.query(`SELECT * FROM "${t}"`);
    const sql = `INSERT INTO \`${t}\` (${names.map((c) => `\`${c}\``).join(',')}) VALUES (${names.map(() => '?').join(',')})`;
    const values = rows.map((r) => names.map((c) => {
      const v = r[c]; const type = cols.get(c);
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return type === 'date' ? dt(v).slice(0, 10) : dt(v);
      if (type === 'longtext' && (typeof v === 'object')) return JSON.stringify(v);     // JSON columns (MariaDB JSON = LONGTEXT), incl. former text[]/uuid[]
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    }));
    for (let i = 0; i < values.length; i += 500) if (values.slice(i, i + 500).length) await my.batch(sql, values.slice(i, i + 500));
    const n = Number((await my.query(`SELECT COUNT(*) n FROM \`${t}\``))[0].n);
    report.push({ table: t, source: rows.length, target: n, ok: n === rows.length });
  }
  for (const tr of ANSWER_TRIGGERS) await my.query(`CREATE TRIGGER \`${tr.name}\` BEFORE ${tr.timing} ON \`attempt_answers\` FOR EACH ROW
BEGIN
  IF (SELECT \`status\` FROM \`attempts\` WHERE \`id\` = ${tr.row}.\`attemptId\`) <> 'IN_PROGRESS' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attempt is finalised; answers are immutable';
  END IF;
END`);
  await my.query('SET FOREIGN_KEY_CHECKS = 1');

  const seq = await src.query("SELECT last_value, is_called FROM certificate_serial_seq").catch(() => null);
  if (seq?.rows[0]) { const next = Number(seq.rows[0].last_value) + (seq.rows[0].is_called ? 1 : 0); await my.query(`ALTER SEQUENCE certificate_serial_seq RESTART WITH ${Math.max(1000, next)}`); report.push({ table: 'certificate_serial_seq', next }); }
  console.table(report);
  if (report.some((r) => r.ok === false)) { console.error('Row counts differ — do NOT cut over.'); process.exitCode = 1; } else console.log('Copy complete: every table matches the source row count.');
} finally {
  await src.end(); await my.end();
}
