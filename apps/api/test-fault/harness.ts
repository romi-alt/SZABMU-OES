/**
 * Fault-injection harness. Everything here runs on DISPOSABLE infrastructure created under a fresh temp directory:
 * its own PostgreSQL 16 cluster (random port, trust auth, 127.0.0.1 only), its own Redis (random port) and its own API
 * processes. Child processes receive an explicit minimal environment, never this process's DATABASE_URL/REDIS_URL,
 * so these tests cannot reach the shared development/test databases or any production system.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import Redis from 'ioredis';

export const API_DIR = path.resolve(__dirname, '..');
export const REPO_DIR = path.resolve(API_DIR, '../..');
const PG_BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
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
function asPg(cmd: string, args: string[], opts: { input?: string } = {}) {
  // PostgreSQL refuses to run as root; use the postgres OS user in this sandbox.
  return isRoot ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: 'pipe', ...opts }) : execFileSync(cmd, args, { stdio: 'pipe', ...opts });
}

export class DisposablePg {
  readonly dir = mkdtempSync(path.join(os.tmpdir(), 'oes-fault-'));
  port = 0; readonly db = 'fault_oes';
  private get data() { return path.join(this.dir, 'data'); }
  get url() { return `postgresql://oes@127.0.0.1:${this.port}/${this.db}`; }
  get adminUrl() { return `postgresql://oes@127.0.0.1:${this.port}/postgres`; }

  async init() {
    chmodSync(this.dir, 0o755);
    if (isRoot) execFileSync('chown', ['postgres:postgres', this.dir]);
    mkdirSync(path.join(this.dir, 'sock'), { mode: 0o777 }); if (isRoot) execFileSync('chown', ['postgres:postgres', path.join(this.dir, 'sock')]);
    asPg(`${PG_BIN}/initdb`, ['-D', this.data, '-U', 'oes', '--auth=trust', '-E', 'UTF8', '--locale=C']);
    this.port = await freePort();
    await this.start();
    const c = new pg.Client({ connectionString: this.adminUrl }); await c.connect();
    await c.query(`CREATE DATABASE ${this.db}`); await c.end();
  }
  async start() {
    asPg(`${PG_BIN}/pg_ctl`, ['-D', this.data, '-l', path.join(this.dir, 'pg.log'), '-w', '-t', '60', '-o',
      `-p ${this.port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${path.join(this.dir, 'sock')} -c max_connections=100 -c fsync=on -c synchronous_commit=on -c full_page_writes=on`, 'start']);
  }
  /** Simulates a server crash: no shutdown checkpoint; the next start performs WAL crash recovery. */
  crash() { asPg(`${PG_BIN}/pg_ctl`, ['-D', this.data, '-m', 'immediate', '-w', '-t', '60', 'stop']); }
  stop() { try { asPg(`${PG_BIN}/pg_ctl`, ['-D', this.data, '-m', 'fast', '-w', '-t', '60', 'stop']); } catch { /* already stopped */ } }
  pool() { return new pg.Pool({ connectionString: this.url, max: 4 }); }
  destroy() { this.stop(); rmSync(this.dir, { recursive: true, force: true }); }
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
  kill() { this.proc?.kill('SIGKILL'); this.proc = undefined; }
}

export interface InfraEnv { DATABASE_URL: string; REDIS_URL: string }
function childEnv(i: InfraEnv, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Hard guard: never run against the shared dev/test services.
  if (/:5433\//.test(i.DATABASE_URL) || /:6390\b/.test(i.REDIS_URL) || !/127\.0\.0\.1/.test(i.DATABASE_URL)) throw new Error('refusing to run fault injection against shared infrastructure');
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

export function readLog(db: DisposablePg) { try { return readFileSync(path.join(db.dir, 'pg.log'), 'utf8'); } catch { return ''; } }
