/**
 * Fault-injection harness. Everything here runs on DISPOSABLE infrastructure created under a fresh temp directory:
 * its own MariaDB server (random port, 127.0.0.1 only, as in production: READ COMMITTED, InnoDB with a flush at every commit),
 * its own Redis (random port) and its own API processes. Child processes receive an explicit minimal environment, never this
 * process's DATABASE_URL/REDIS_URL, so these tests cannot reach the shared development/test databases or any production system.
 * (Ported from PostgreSQL in the 2026-11 audit, T-QA-01. `pool().query` accepts the PostgreSQL-style SQL the tests were written in
 * — `$n` placeholders, `::casts`, `clock_timestamp()`, `interval '…'`, `= ANY($n)`, `IS NOT DISTINCT FROM` — and runs it on MariaDB.)
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import mariadb, { type Pool } from 'mariadb';
import Redis from 'ioredis';
import { PoolErrorPolicy } from './pool-errors';

export const API_DIR = path.resolve(__dirname, '..');
export const REPO_DIR = path.resolve(API_DIR, '../..');
export const DOMAIN = 'demo.szabmu.invalid';
export const PASSWORD = 'Demo-Passw0rd-2026!';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until<T>(what: string, fn: () => Promise<T | false | undefined | null>, timeoutMs = 30_000, everyMs = 200): Promise<T> {
  const end = Date.now() + timeoutMs; let last: unknown;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(everyMs); }
  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ''}`);
}
export const freePort = () => new Promise<number>((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); s.on('error', reject); });

const isRoot = process.getuid?.() === 0;
const MARIADB_BIN = process.env.MARIADB_BIN;
const exe = (n: string) => (MARIADB_BIN ? path.join(MARIADB_BIN, n) : n);
const SESSION_INIT = ["SET time_zone = '+00:00'", "SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES', 'STRICT_TRANS_TABLES')"];

/** Translates the PostgreSQL dialect used by the fault tests into MariaDB, expanding `$n` (repeatable) into positional `?`. */
export function toMariaDb(sql: string, params: unknown[] = []): { sql: string; params: unknown[] } {
  const out: unknown[] = [];
  let q = sql
    .replace(/clock_timestamp\(\)/gi, 'NOW(6)')
    .replace(/interval '(\d+) (second|minute|hour|day)s?'/gi, (_m, n, u) => `INTERVAL ${n} ${u.toUpperCase()}`)
    .replace(/IS NOT DISTINCT FROM/gi, '<=>');
  q = q.replace(/= ANY\(\$(\d+)(::\w+\[\])?\)/g, (_m, n) => { const arr = params[Number(n) - 1] as unknown[]; out.push(...arr); return `IN (${arr.map(() => '?').join(',') || 'NULL'})`; });
  q = q.replace(/::\w+(\[\])?/g, '');
  // remaining placeholders, in order of appearance (ANY() expansions above were consumed first: they never mix in one statement here)
  q = q.replace(/\$(\d+)/g, (_m, n) => { out.push(params[Number(n) - 1]); return '?'; });
  return { sql: q, params: out };
}
export interface DbPool { query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; end(): Promise<void> }

export class DisposableMariaDb {
  readonly dir = mkdtempSync(path.join(os.tmpdir(), 'oes-fault-'));
  port = 0; readonly db = 'fault_oes';
  /** Classifies errors from pools handed out by `pool()`: connection loss is expected only inside a declared outage. */
  readonly errors = new PoolErrorPolicy();
  private readonly pools = new Set<Pool>();
  private proc?: ChildProcess;
  private get data() { return path.join(this.dir, 'data'); }
  private get sock() { return path.join(this.dir, 'run', 'm.sock'); }
  private get pidFile() { return path.join(this.dir, 'run', 'm.pid'); }
  get url() { return `mysql://oes:fault-pw@127.0.0.1:${this.port}/${this.db}`; }

  async init() {
    chmodSync(this.dir, 0o755); mkdirSync(path.join(this.dir, 'run'), { mode: 0o777 });
    if (isRoot) execFileSync('chown', ['-R', 'mysql:mysql', this.dir]);
    execFileSync(exe('mariadb-install-db'), [...(isRoot ? ['--user=mysql'] : []), `--datadir=${this.data}`, '--auth-root-authentication-method=socket'], { stdio: 'pipe' });
    this.port = await freePort();
    await this.start();
    const root = isRoot ? ['-uroot'] : [];
    execFileSync(exe('mariadb'), ['-S', this.sock, ...root, '-e',
      `CREATE DATABASE ${this.db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'oes'@'127.0.0.1' IDENTIFIED BY 'fault-pw'; GRANT ALL ON *.* TO 'oes'@'127.0.0.1'; FLUSH PRIVILEGES;`], { stdio: 'pipe' });
  }
  async start() {
    const args = [`--datadir=${this.data}`, `--port=${this.port}`, '--bind-address=127.0.0.1', `--socket=${this.sock}`, `--pid-file=${this.pidFile}`,
      '--transaction-isolation=READ-COMMITTED', '--max-connections=200', '--log-bin-trust-function-creators=1', '--skip-log-bin',
      '--innodb-flush-log-at-trx-commit=1', '--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci', '--innodb-buffer-pool-size=128M', `--log-error=${path.join(this.dir, 'err.log')}`];
    this.proc = isRoot ? spawn('runuser', ['-u', 'mysql', '--', exe('mariadbd'), ...args], { stdio: 'ignore' }) : spawn(exe('mariadbd'), args, { stdio: 'ignore' });
    await until('mariadb', async () => { const c = await mariadb.createConnection({ host: '127.0.0.1', port: this.port, user: 'root', socketPath: this.sock, connectTimeout: 1000 }).catch(() => null); if (!c) return false; await c.end(); return true; }, 60_000, 200);
    this.errors.endOutage();
  }
  private serverPid(): number | null { try { return Number(readFileSync(this.pidFile, 'utf8').trim()) || null; } catch { return null; } }
  private async waitGone(pid: number) { await until('mariadb exit', async () => { try { process.kill(pid, 0); return false; } catch { return true; } }, 60_000, 100); }
  /** Simulates a server crash: SIGKILL, no shutdown; the next start performs InnoDB crash recovery from the redo log. */
  async crash() { this.errors.beginOutage(); const pid = this.serverPid(); if (pid) { process.kill(pid, 'SIGKILL'); await this.waitGone(pid); } }
  async stop() { const pid = this.serverPid(); if (!pid) return; try { process.kill(pid, 'SIGTERM'); await this.waitGone(pid); } catch { /* already stopped */ } }
  pool(): DbPool {
    const p = mariadb.createPool({ host: '127.0.0.1', port: this.port, user: 'oes', password: 'fault-pw', database: this.db, connectionLimit: 4, initSql: SESSION_INIT, bigIntAsNumber: true, decimalAsNumber: true, acquireTimeout: 20_000 });
    this.pools.add(p);   // the mariadb pool has no 'error' event: a lost connection surfaces as an error of the query that used it
    return {
      query: async (sql, params) => { const t = toMariaDb(sql, params); const r = await p.query(t.sql, t.params); return { rows: Array.isArray(r) ? r : [] }; },
      end: () => p.end(),
    };
  }
  /** Ends every pool handed out by `pool()`; a pool that is already broken must not mask the real test result. */
  async closePools() { await Promise.all([...this.pools].map((p) => p.end().catch(() => undefined))); this.pools.clear(); }
  async destroy() { await this.stop(); rmSync(this.dir, { recursive: true, force: true }); }
}

export class DisposableRedis {
  proc?: ChildProcess; port = 0;
  get url() { return `redis://127.0.0.1:${this.port}`; }
  async start() {
    if (!this.port) this.port = await freePort();
    this.proc = spawn('redis-server', ['--port', String(this.port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--dir', os.tmpdir()], { stdio: 'ignore' });
    await until('redis', async () => { const r = new Redis(this.url, { lazyConnect: true, maxRetriesPerRequest: 0 }); r.on('error', () => undefined); try { await r.connect(); return (await r.ping()) === 'PONG'; } finally { r.disconnect(); } });
  }
  async flushAll() { const r = new Redis(this.url, { maxRetriesPerRequest: 0 }); r.on('error', () => undefined); try { await r.flushall(); } finally { r.disconnect(); } }
  /** SIGKILL and wait for the process to be gone (no leaked redis-server). */
  async kill() {
    const p = this.proc; this.proc = undefined; if (!p || p.exitCode !== null || p.signalCode) return;
    await new Promise<void>((resolve) => { p.once('exit', () => resolve()); p.kill('SIGKILL'); });
  }
}

export interface InfraEnv { DATABASE_URL: string; REDIS_URL: string }
function childEnv(i: InfraEnv, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Hard guard: never run against the shared dev/test services.
  if (/:(3306|3307|5433)\//.test(i.DATABASE_URL) || /:6390\b/.test(i.REDIS_URL) || !/127\.0\.0\.1/.test(i.DATABASE_URL)) throw new Error('refusing to run fault injection against shared infrastructure');
  return {
    PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', ...i,
    API_HOST: '127.0.0.1', WEB_ORIGIN: 'http://localhost:3000', COOKIE_SECRET: 'fault-test-cookie-secret-0123456789abcdef', RECEIPT_SECRET: 'fault-test-receipt-secret-0123456789abcdef',
    RUN_WORKERS: 'false', DEV_EXPOSE_CODES: 'false', DB_POOL_MAX: '10', SEED_STUDENTS_PER_CAMPUS: process.env.SEED_STUDENTS_PER_CAMPUS ?? '6', ...extra,
  };
}

export function migrateAndSeed(i: InfraEnv) {
  const env = childEnv(i);
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: API_DIR, env, stdio: 'pipe' });
  execFileSync(process.execPath, ['dist/seed/seed.js', '--reset'], { cwd: API_DIR, env, stdio: 'pipe' });
}

export class Api {
  proc?: ChildProcess; port = 0; log = '';
  constructor(private readonly infra: InfraEnv, private readonly entry = 'dist/main.js', private readonly extraEnv: Record<string, string> = {}) {}
  get base() { return `http://127.0.0.1:${this.port}/api`; }
  async start() {
    if (!this.port) this.port = await freePort();
    this.log = '';
    this.proc = spawn(process.execPath, [this.entry], { cwd: API_DIR, env: childEnv(this.infra, { API_PORT: String(this.port), ...this.extraEnv }), stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout?.on('data', (d) => { this.log += d; }); this.proc.stderr?.on('data', (d) => { this.log += d; });
    await until('api health', async () => (await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(2000) })).ok);
  }
  async health() { try { const r = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(2000) }); return r.ok ? await r.json() as { db: boolean; redis: boolean } : null; } catch { return null; } }
  async kill(sig: NodeJS.Signals = 'SIGKILL') {
    const p = this.proc; if (!p || p.exitCode !== null) return; this.proc = undefined;
    await new Promise<void>((resolve) => { p.once('exit', () => resolve()); p.kill(sig); });
  }
}

/** TCP proxy used to lose HTTP responses AFTER the API has handled (committed) the request. */
export class DropProxy {
  server?: net.Server; port = 0; dropResponses = false; dropped = 0;
  constructor(private readonly target: () => number) {}
  get base() { return `http://127.0.0.1:${this.port}/api`; }
  async start() {
    this.server = net.createServer((client) => {
      const upstream = net.connect(this.target(), '127.0.0.1');
      client.on('data', (d) => upstream.write(d));
      upstream.on('data', (d) => { if (this.dropResponses) { this.dropped++; client.destroy(); upstream.destroy(); } else client.write(d); });
      const close = () => { client.destroy(); upstream.destroy(); };
      client.on('error', close); upstream.on('error', close); client.on('close', close); upstream.on('close', close);
    });
    await new Promise<void>((r) => this.server!.listen(this.port, '127.0.0.1', r));
    this.port = (this.server.address() as net.AddressInfo).port;
  }
  stop() { this.server?.close(); this.server?.closeAllConnections?.(); }
}

export type Res<T = any> = { status: number; body: T };
export class Student {
  cookie = ''; constructor(public base: string, readonly local: string) {}
  async call<T = any>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<Res<T>> {
    const r = await fetch(`${this.base}${p}`, { method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text(); let parsed: any = text; try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, body: parsed };
  }
  async login(base = this.base) {
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${this.local}@${DOMAIN}`, password: PASSWORD }) });
    if (r.status !== 200) throw new Error(`login ${this.local}: ${r.status}`);
    this.cookie = r.headers.getSetCookie()[0]!.split(';')[0]!; return this;
  }
}

export function readLog(db: DisposableMariaDb) { try { return readFileSync(path.join(db.dir, 'err.log'), 'utf8'); } catch { return ''; } }
