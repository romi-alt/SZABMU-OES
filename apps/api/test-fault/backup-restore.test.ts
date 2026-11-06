import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mariadb from 'mariadb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, DisposableMariaDb, DisposableRedis, REPO_DIR, Student, migrateAndSeed, sleep, until, type DbPool } from './harness';

/**
 * A backup is only accepted when it has been RESTORED in isolation and verified. This suite exercises
 * scripts/db-backup.mjs against a disposable source cluster, taking the backup WHILE candidates are writing.
 */
let src: DisposableMariaDb; let redisA: DisposableRedis; let redisB: DisposableRedis; let apiA: Api; let apiB: Api | undefined; let pool: DbPool; let work: string;
const SCRIPT = path.join(REPO_DIR, 'scripts/db-backup.mjs');
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_DIR });
// the kept restore server is a throw-away mariadbd started by scripts/db-backup.mjs; it is identified exactly by its own temp data directory
const stopCluster = (dataDir: string) => { try { execFileSync('pkill', ['-TERM', '-f', `--datadir=${dataDir}`], { stdio: 'pipe' }); execFileSync('sleep', ['2']); } catch { /* already stopped */ } };

beforeAll(async () => {
  execFileSync('npm', ['run', 'build:shared'], { cwd: REPO_DIR, stdio: 'pipe' });
  execFileSync('npm', ['run', 'build', '-w', '@oes/api'], { cwd: REPO_DIR, stdio: 'pipe' });
  work = mkdtempSync(path.join(os.tmpdir(), 'oes-bk-test-'));
  src = new DisposableMariaDb(); await src.init();
  redisA = new DisposableRedis(); await redisA.start(); redisB = new DisposableRedis(); await redisB.start();
  process.env.SEED_STUDENTS_PER_CAMPUS = '10';
  migrateAndSeed({ DATABASE_URL: src.url, REDIS_URL: redisA.url });
  apiA = new Api({ DATABASE_URL: src.url, REDIS_URL: redisA.url }); await apiA.start();
  pool = src.pool();
}, 300_000);

afterAll(async () => {
  try { await src?.closePools(); await apiB?.kill(); await apiA?.kill(); await redisA?.kill(); await redisB?.kill(); await src?.destroy(); if (work) rmSync(work, { recursive: true, force: true }); }
  finally { src?.errors.assertClean(); }
});

describe('backup → isolated restore → verification', () => {
  let dump = ''; let attemptId = ''; let receipt = ''; let stu: Student; let ackedBeforeBackup = 0;

  it('takes a consistent backup while candidates are actively saving, then verifies it by restoring into a disposable cluster', async () => {
    const examId = (await pool.query(`SELECT id FROM exams WHERE code = 'MBBS-PATH-MT'`)).rows[0].id;
    const qids: string[] = (await pool.query(`SELECT id FROM exam_questions WHERE "examId" = $1 ORDER BY position`, [examId])).rows.map((r) => r.id);
    // one candidate sits and SUBMITS (sealed receipt must survive); three more keep writing during the backup
    stu = await new Student(apiA.base, 'student.a002').login(); const clientId = 'bk-' + Date.now();
    attemptId = (await stu.call('POST', '/attempts/start', { examId, clientId })).body.attempt.id;
    for (const [i, q] of qids.entries()) expect((await stu.call('PUT', `/attempts/${attemptId}/answers/${q}`, { clientId, revision: 1, selectedLabel: 'ABCD'[i % 4], state: 'ANSWERED', markedForReview: false, visited: true })).status).toBe(200);
    receipt = (await stu.call('POST', `/attempts/${attemptId}/submit`, { clientId, submitKey: 'bk-submit-1' })).body.receiptCode;
    expect(receipt).toMatch(/^RC-/);
    let writing = true; const writers = ['student.a003', 'student.a004', 'student.a005'].map(async (local, k) => {
      const s = await new Student(apiA.base, local).login(); const cid = `backup-writer-${k}`;
      const st = await s.call('POST', '/attempts/start', { examId, clientId: cid }); if (st.status !== 200) throw new Error(`writer ${local} start failed: ${st.status} ${JSON.stringify(st.body)}`); const a = st.body.attempt.id;
      for (let rev = 1; writing; rev++) { for (const [i, q] of qids.entries()) { if (!writing) break; await s.call('PUT', `/attempts/${a}/answers/${q}`, { clientId: cid, revision: rev, selectedLabel: 'ABCD'[(i + rev) % 4], state: 'ANSWERED', markedForReview: false, visited: true }).catch(() => undefined); await sleep(120); } }
    });
    await until('writers active', async () => (await pool.query(`SELECT count(*)::int n FROM answer_events`)).rows[0].n > 40, 30_000, 100);
    const b = run(['backup', '--url', src.url, '--out', work]);              // <- while writes continue
    writing = false; await Promise.all(writers);
    expect(b.status, b.stderr).toBe(0);
    const info = JSON.parse(b.stdout.trim().split('\n').pop()!);
    expect(info.note).toMatch(/NOT verified/); dump = info.dump; ackedBeforeBackup = info.rows;
    const v = run(['verify', '--backup', dump]);
    expect(v.status, v.stdout + v.stderr).toBe(0);
    const rep = JSON.parse(v.stdout);
    expect(rep.ok).toBe(true);
    expect(rep.checks).toMatchObject({ checksum: true, restore: true, contentMatches: true, migrations: true, triggers: true, auditAppendOnly: true });
    expect(rep.checks.tables).toBeGreaterThanOrEqual(35);
    console.log(`[BK] backup ${info.bytes} bytes · ${rep.checks.tables} tables · ${info.rows} rows taken during live writes · restore+verify OK`);
    expect(readdirSync('/tmp').filter((n) => n.startsWith('oes-restore-')).length).toBe(0); // disposable cluster cleaned up
  }, 240_000);

  it('the restored database is a working system: API boots on it, audit hash chain verifies, the sealed receipt and answers are intact', async () => {
    const v = run(['verify', '--backup', dump, '--keep']);
    expect(v.status, v.stdout + v.stderr).toBe(0);
    const rep = JSON.parse(v.stdout);
    try {
      // the report redacts the password; the throw-away restore server's root account has an empty one
      const restoredUrl = String(rep.restoredUrl).replace(':***@', ':@');
      apiB = new Api({ DATABASE_URL: restoredUrl, REDIS_URL: redisB.url }); await apiB.start();
      const cce = await new Student(apiB.base, 'cce').login();
      const chain = await cce.call('GET', '/audit/verify');
      expect(chain.status).toBe(200); expect(chain.body.brokenAt).toBeNull(); expect(chain.body.checked).toBeGreaterThan(0);
      // the candidate's session survived (sessions are in the database); their sealed attempt and receipt are intact
      const s2 = new Student(apiB.base, 'student.a002'); s2.cookie = stu.cookie;
      const r = await s2.call('GET', `/attempts/${attemptId}/receipt`);
      expect(r.status).toBe(200); expect(JSON.stringify(r.body)).toContain(receipt);
      const u = new URL(restoredUrl); const rc = await mariadb.createConnection({ host: u.hostname, port: +u.port, user: 'root', password: '', database: u.pathname.slice(1), bigIntAsNumber: true });
      try { expect((await rc.query('SELECT count(*) n FROM attempt_answers WHERE `attemptId` = ?', [attemptId]))[0].n).toBe(12); } finally { await rc.end(); }
      expect(ackedBeforeBackup).toBeGreaterThan(0);
    } finally { await apiB?.kill(); apiB = undefined; stopCluster(rep.dataDir); rmSync(path.dirname(rep.dataDir), { recursive: true, force: true }); }
  }, 240_000);

  it('rejects a corrupted dump (checksum) and a tampered manifest (content fingerprint) — it never reports a bad backup as good', async () => {
    const bad = path.join(work, 'corrupt.dump'); copyFileSync(dump, bad); copyFileSync(`${dump}.manifest.json`, `${bad}.manifest.json`);
    const buf = readFileSync(bad); buf[Math.floor(buf.length / 2)] ^= 0xff; writeFileSync(bad, buf);
    const c = run(['verify', '--backup', bad]);
    expect(c.status).toBe(1); expect(JSON.parse(c.stdout).problems.join(' ')).toMatch(/checksum mismatch/);

    const tam = path.join(work, 'tampered.dump'); copyFileSync(dump, tam);
    const m = JSON.parse(readFileSync(`${dump}.manifest.json`, 'utf8')); m.tables.attempt_answers.fingerprint = '1' + m.tables.attempt_answers.fingerprint; writeFileSync(`${tam}.manifest.json`, JSON.stringify(m));
    const t = run(['verify', '--backup', tam]);
    expect(t.status).toBe(1); expect(JSON.parse(t.stdout).problems.join(' ')).toMatch(/attempt_answers: content fingerprint differs/);

    const none = run(['verify', '--backup', path.join(work, 'does-not-exist.dump')]);
    expect(none.status).toBe(2);
  }, 240_000);
});
