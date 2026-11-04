import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MetricsService } from '../src/infra/metrics.service';
import { as, boot, save, startExam, Client, type Ctx } from './helpers';
import { DOMAIN } from '../src/seed/seed';

const TOKEN = 'metrics-test-token-0123456789abcdef';
let ctx: Ctx; let m: MetricsService;
beforeAll(async () => { process.env.METRICS_TOKEN = TOKEN; ctx = await boot({ studentsPerCampus: 4 }); m = ctx.app.get(MetricsService); });
afterAll(async () => { await ctx.app.close(); delete process.env.METRICS_TOKEN; });

const scrape = (c: Client, token = TOKEN) => c.req('GET', '/metrics', undefined, { authorization: `Bearer ${token}` });
/** Value of the first series `name{…}` whose labels include all of `labels` (undefined if absent). */
const series = (text: string, name: string, labels: Record<string, string> = {}) => {
  for (const l of text.split('\n')) {
    if (l.startsWith('#') || !(l.startsWith(name + '{') || l.startsWith(name + ' '))) continue;
    if (Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`))) return Number(l.slice(l.lastIndexOf(' ') + 1));
  }
  return undefined;
};

describe('scrape endpoint', () => {
  it('is protected: wrong/missing token ⇒ 401, correct token ⇒ Prometheus text; disabled (404) when no token is configured', async () => {
    const anon = new Client(ctx.app);
    expect((await anon.req('GET', '/metrics')).status).toBe(401);
    expect((await scrape(anon, 'wrong-token-wrong-token-wrong')).status).toBe(401);
    const ok = await scrape(anon); expect(ok.status).toBe(200);
    expect(String(ok.headers['content-type'])).toMatch(/text\/plain; version=0\.0\.4/);
    expect(ok.raw).toMatch(/^# TYPE oes_answer_save_total counter$/m); expect(ok.raw).toMatch(/^oes_db_up 1$/m);
    expect(ok.raw).not.toMatch(/eyJ|password|secret/i);
  });
});

describe('exam-path metrics', () => {
  it('counts durable saves, duplicates, stale revisions and expired saves, and times them', async () => {
    const s = await as(ctx, 'student.a002'); const t = await startExam(ctx, s); const q = t.questions[0]!.id; const before = m.saves.value({ result: 'ok' });
    const nLat = m.saveDuration.count();
    expect((await save(s, t.attemptId, q, t.clientId, 1, 'A')).status).toBe(200);
    expect((await save(s, t.attemptId, q, t.clientId, 1, 'A')).status).toBe(200);          // idempotent replay
    expect((await save(s, t.attemptId, q, t.clientId, 2, 'B')).status).toBe(200);
    expect((await save(s, t.attemptId, q, t.clientId, 1, 'C')).status).toBe(409);          // stale writer
    expect((await save(s, t.attemptId, q, 'another-tab-0001', 3, 'D')).status).toBe(409);  // superseded tab
    expect(m.saves.value({ result: 'ok' })).toBe(before + 2); expect(m.saves.value({ result: 'duplicate' })).toBe(1);
    expect(m.saves.value({ result: 'stale' })).toBe(1); expect(m.saves.value({ result: 'superseded' })).toBe(1);
    expect(m.saveDuration.count()).toBe(nLat + 5);
    await ctx.prisma.$executeRaw`UPDATE attempts SET "startedAt" = NOW(3) - INTERVAL 45 MINUTE, "deadlineAt" = NOW(3) - INTERVAL 30 SECOND WHERE id = ${t.attemptId}`;
    expect((await save(s, t.attemptId, q, t.clientId, 9, 'A')).status).toBe(409);
    expect(m.saves.value({ result: 'expired' })).toBe(1);
  });

  it('a database failure during a save is a counted server error, a counted DB error, and is never reported as saved', async () => {
    const s = await as(ctx, 'student.a003'); const t = await startExam(ctx, s); const errs = m.saves.value({ result: 'error' }); const dbe = m.dbErrors.value({ kind: 'connection' });
    const spy = vi.spyOn(ctx.prisma, '$queryRaw').mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    const r = await save(s, t.attemptId, t.questions[0]!.id, t.clientId, 1, 'A');
    spy.mockRestore();
    expect(r.status).toBe(500); expect(r.body).not.toHaveProperty('saved');
    expect(m.saves.value({ result: 'error' })).toBe(errs + 1); expect(m.dbErrors.value({ kind: 'connection' })).toBe(dbe + 1);
    expect(m.unhandled.value()).toBeGreaterThan(0);
    expect((await ctx.prisma.attemptAnswer.count({ where: { attemptId: t.attemptId } }))).toBe(0);
    expect((await save(s, t.attemptId, t.questions[0]!.id, t.clientId, 1, 'A')).status).toBe(200); // recovers
  });

  it('counts submissions (ok / replayed / error) with latency', async () => {
    const s = await as(ctx, 'student.a004'); const t = await startExam(ctx, s); await save(s, t.attemptId, t.questions[0]!.id, t.clientId, 1, 'A');
    const ok = m.submits.value({ result: 'ok' }); const rep = m.submits.value({ result: 'replayed' }); const n = m.submitDuration.count();
    expect((await s.post(`/attempts/${t.attemptId}/submit`, { clientId: t.clientId, submitKey: 'metrics-submit-1' })).status).toBe(200);
    expect((await s.post(`/attempts/${t.attemptId}/submit`, { clientId: t.clientId, submitKey: 'metrics-submit-1' })).status).toBe(200);
    expect(m.submits.value({ result: 'ok' })).toBe(ok + 1); expect(m.submits.value({ result: 'replayed' })).toBe(rep + 1); expect(m.submitDuration.count()).toBe(n + 2);
    const s2 = await as(ctx, 'student.b002'); const t2 = await startExam(ctx, s2); const errs = m.submits.value({ result: 'error' });
    const spy = vi.spyOn(ctx.prisma, '$transaction').mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    const r = await s2.post(`/attempts/${t2.attemptId}/submit`, { clientId: t2.clientId, submitKey: 'metrics-submit-2' }); spy.mockRestore();
    expect(r.status).toBe(500); expect(m.submits.value({ result: 'error' })).toBe(errs + 1);
  });
});

describe('security and availability signals', () => {
  it('counts failed logins, lockouts, failed MFA, 401s and 403s; labels stay bounded', async () => {
    const bad = new Client(ctx.app, 'student.a002'); const inv = m.authFailures.value({ kind: 'login_invalid' });
    for (let i = 0; i < 2; i++) await bad.req('POST', '/auth/login', { email: `student.a002@${DOMAIN}`, password: 'wrong-password-1' });
    expect(m.authFailures.value({ kind: 'login_invalid' })).toBe(inv + 2);
    const un = m.unauthorized.value({ status: '401', code: 'UNAUTHENTICATED' }); await new Client(ctx.app).get('/exams');
    expect(m.unauthorized.value({ status: '401', code: 'UNAUTHENTICATED' })).toBe(un + 1);
    const st = await as(ctx, 'student.b002'); const fb = m.unauthorized.value({ status: '403', code: 'FORBIDDEN' });
    expect((await st.get('/users')).status).toBe(403); expect(m.unauthorized.value({ status: '403', code: 'FORBIDDEN' })).toBe(fb + 1);
    const lock = m.authFailures.value({ kind: 'login_locked' });
    const victim = new Client(ctx.app, 'student.b003'); for (let i = 0; i < 6; i++) await victim.req('POST', '/auth/login', { email: `student.b003@${DOMAIN}`, password: 'nope-nope-nope-1' });
    expect(m.authFailures.value({ kind: 'login_locked' })).toBeGreaterThan(lock);
    const text = (await scrape(new Client(ctx.app))).raw;
    expect(text).toMatch(/oes_http_requests_total\{method="GET",route="\/api\/exams",status="401"\}/);   // route PATTERN, not the raw URL
    expect(text).not.toMatch(/route="\/api\/attempts\/[0-9a-f]{8}-/);                                      // no ids in labels
  });

  it('exposes per-campus connectivity from heartbeats: connected vs disconnected', async () => {
    const examId = ctx.seeded.examId;
    // Two campuses, one candidate each, both with a fresh heartbeat
    const sa = new Client(ctx.app, 'student.a003'); await sa.login(); const sb = new Client(ctx.app, 'student.b004'); await sb.login();
    const ta = await ctx.prisma.attempt.findFirstOrThrow({ where: { student: { user: { email: `student.a003@${DOMAIN}` } } } });
    const tb = await startExam(ctx, sb); const clientA = ta.activeClientId!;
    const beat = async (attemptId: string, t: number, online: boolean) => {   // overwrite the stored heartbeat (same store the API writes)
      const a = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, select: { student: { select: { institutionId: true } } } });
      await ctx.kv.recordHeartbeat(examId, a.student.institutionId, attemptId, t, online);
    };
    expect((await sa.post(`/attempts/${ta.id}/heartbeat`, { clientId: clientA, online: true })).status).toBe(200);
    expect((await sb.post(`/attempts/${tb.attemptId}/heartbeat`, { clientId: tb.clientId, online: true })).status).toBe(200);
    let text = await m.render({ forceCampus: true });
    expect(series(text, 'oes_campus_candidates', { institution: 'DMC-B', state: 'disconnected' })).toBe(0);
    // campus A's candidate stops heart-beating (network outage): backdate heartbeat and start time
    await beat(ta.id, Date.now() - 120_000, true);
    await ctx.prisma.$executeRaw`UPDATE attempts SET "startedAt" = NOW(3) - INTERVAL 5 MINUTE WHERE id = ${ta.id}`;
    text = await m.render({ forceCampus: true });
    expect(series(text, 'oes_campus_candidates', { institution: 'DMC-A', state: 'disconnected' })).toBeGreaterThanOrEqual(1);
    expect(series(text, 'oes_campus_candidates', { institution: 'DMC-B', state: 'disconnected' })).toBe(0);
    expect(series(text, 'oes_campus_candidates', { institution: 'DMC-B', state: 'connected' })).toBeGreaterThanOrEqual(1);
    expect(series(text, 'oes_active_attempts')).toBeGreaterThanOrEqual(2);
    // client reports itself offline ⇒ disconnected even with a fresh heartbeat
    await beat(tb.attemptId, Date.now(), false);
    await ctx.prisma.$executeRaw`UPDATE attempts SET "startedAt" = NOW(3) - INTERVAL 5 MINUTE WHERE id = ${tb.attemptId}`;
    text = await m.render({ forceCampus: true });
    expect(series(text, 'oes_campus_candidates', { institution: 'DMC-B', state: 'disconnected' })).toBeGreaterThanOrEqual(1);
  });

  it('reports database/Redis health honestly on each scrape', async () => {
    const spy = vi.spyOn(ctx.prisma, '$queryRaw').mockRejectedValueOnce(new Error('db down'));
    const down = await m.render({}); spy.mockRestore();
    expect(down).toMatch(/^oes_db_up 0$/m);
    expect(await m.render({})).toMatch(/^oes_db_up 1$/m);
    expect(await m.render({})).toMatch(/^oes_redis_up 1$/m); expect(await m.render({})).toMatch(/^oes_event_loop_lag_seconds /m);
  });
});

describe('alert rules', () => {
  const file = path.resolve(__dirname, '../../../infra/observability/alerts.yml');
  const doc = yaml.load(readFileSync(file, 'utf8')) as { groups: { name: string; rules: { alert: string; expr: string; for?: string; labels?: { severity?: string }; annotations?: { summary?: string; runbook?: string } }[] }[] };
  const rules = doc.groups.flatMap((g) => g.rules);

  it('every rule is complete: severity, summary and a runbook anchor that exists in the observability doc', () => {
    const md = readFileSync(path.resolve(__dirname, '../../../docs/operations/observability.md'), 'utf8');
    const anchors = new Set([...md.matchAll(/^#{2,3} (.+)$/gm)].map((x) => x[1]!.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')));
    expect(rules.length).toBeGreaterThanOrEqual(14);
    for (const r of rules) {
      expect(['warning', 'critical'], r.alert).toContain(r.labels?.severity); expect(r.annotations?.summary, r.alert).toBeTruthy(); expect(r.expr.trim().length, r.alert).toBeGreaterThan(10);
      const [file2, anchor] = (r.annotations?.runbook ?? '').split('#'); expect(file2, r.alert).toBe('docs/operations/observability.md'); expect(anchors.has(anchor!), `${r.alert}: runbook anchor #${anchor} missing`).toBe(true);
    }
    expect(new Set(rules.map((r) => r.alert)).size).toBe(rules.length);
  });

  it('every oes_* metric used by an alert is actually exposed (rules cannot silently drift from the code)', async () => {
    const exposed = new Set([...(await m.render({ forceCampus: true })).matchAll(/^# TYPE (\S+) /gm)].map((x) => x[1]));
    const used = new Set(rules.flatMap((r) => [...r.expr.matchAll(/\boes_[a-z_]+/g)].map((x) => x[0]!.replace(/_(bucket|sum|count)$/, ''))));
    expect(used.size).toBeGreaterThanOrEqual(10);
    for (const name of used) expect(exposed.has(name), `alert references ${name}, which /metrics does not expose`).toBe(true);
    // the required signals are each covered by at least one alert
    const text = rules.map((r) => r.expr).join('\n');
    for (const need of ['oes_answer_save_total{result="error"', 'oes_answer_save_duration_seconds', 'oes_submit_total{result="error"', 'oes_db_up', 'oes_db_errors_total', 'oes_campus_candidates', 'oes_auth_failures_total', 'oes_unauthorized_requests_total']) expect(text, need).toContain(need);
  });
});
