import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Api, DisposablePg, DisposableRedis, REPO_DIR, migrateAndSeed } from './harness';

/**
 * A/B benchmark of the candidate START path: with vs without the admission lookup (policy P-26).
 * Skipped unless RUN_BENCH=1 (it takes ~8 minutes and saturates the machine):
 *   RUN_BENCH=1 npx vitest run --config vitest.fault.config.ts test-fault/start-ab.test.ts
 * Fresh disposable PostgreSQL + Redis; a NEW API process per round; rounds alternate A,B,A,B,A,B to spread drift/warm-up.
 */
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 3), N = Number(process.env.BENCH_CANDIDATES ?? 2000), RAMP = Number(process.env.BENCH_RAMP ?? 20);
let db: DisposablePg; let redis: DisposableRedis;
const results: Record<'A (with admission)' | 'B (admission stubbed)', { p50: number; p95: number; p99: number; max: number; cpu: string }[]> = { 'A (with admission)': [], 'B (admission stubbed)': [] };

describe.skipIf(process.env.RUN_BENCH !== '1')('start path A/B', () => {
  beforeAll(async () => {
    execFileSync('npm', ['run', 'build:shared'], { cwd: REPO_DIR, stdio: 'pipe' }); execFileSync('npm', ['run', 'build', '-w', '@oes/api'], { cwd: REPO_DIR, stdio: 'pipe' });
    db = new DisposablePg(); await db.init(); redis = new DisposableRedis(); await redis.start(); migrateAndSeed({ DATABASE_URL: db.url, REDIS_URL: redis.url });
  }, 300_000);
  afterAll(async () => { await redis?.kill(); db?.destroy(); });

  it(`${ROUNDS}× alternating, ${N} candidates, ramp ${RAMP}s, start only`, async () => {
    const infra = { DATABASE_URL: db.url, REDIS_URL: redis.url };
    for (let r = 1; r <= ROUNDS; r++) for (const variant of ['A (with admission)', 'B (admission stubbed)'] as const) {
      const api = new Api(infra, 'test-fault/bench-main.cjs', { BENCH_SKIP_ADMIT: variant.startsWith('B') ? '1' : '0' });
      await api.start();
      const out = spawnSync(process.execPath, [path.join(REPO_DIR, 'tests/load/exam-load.mjs'), '--candidates', String(N), '--questions', '50', '--ramp', String(RAMP), '--start-only', '--api', api.base.replace(/\/api$/, '')], { env: { ...process.env, DATABASE_URL: db.url }, encoding: 'utf8', timeout: 600_000 });
      await api.kill('SIGTERM');
      const m = out.stdout.match(/^start\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/m);
      const cpu = out.stdout.match(/host CPU busy.*mean (\d+)%/)?.[1] ?? '?';
      if (!m) throw new Error(`round ${r} ${variant}: no result\n${out.stdout}\n${out.stderr}`);
      results[variant].push({ p50: +m[2]!, p95: +m[3]!, p99: +m[4]!, max: +m[5]!, cpu });
      console.log(`[bench] round ${r} ${variant}: start p50 ${m[2]} p95 ${m[3]} p99 ${m[4]} ms (host CPU mean ${cpu}%)`);
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
    for (const [v, rs] of Object.entries(results)) console.log(`[bench] ${v}: median of ${rs.length} · p50 ${med(rs.map((x) => x.p50)).toFixed(0)} ms · p95 ${med(rs.map((x) => x.p95)).toFixed(0)} ms · p99 ${med(rs.map((x) => x.p99)).toFixed(0)} ms · p95 range ${Math.min(...rs.map((x) => x.p95)).toFixed(0)}–${Math.max(...rs.map((x) => x.p95)).toFixed(0)}`);
  }, 1_800_000);
});
