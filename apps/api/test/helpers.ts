import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/bootstrap';
import { PrismaService } from '../src/infra/prisma.service';
import { KvService } from '../src/infra/kv.service';
import { DOMAIN, DEMO_PASSWORD, resetDatabase, seed } from '../src/seed/seed';
import type { INestApplicationContext } from '@nestjs/common';

export interface Ctx { app: NestFastifyApplication; prisma: PrismaService; kv: KvService; seeded: Awaited<ReturnType<typeof seed>> }

export async function boot(opts: { studentsPerCampus?: number } = {}): Promise<Ctx> {
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const prisma = app.get(PrismaService);
  const kv = app.get(KvService);
  await resetDatabase(prisma);
  await kv.flushAll();
  const seeded = await seed(app as unknown as INestApplicationContext, { studentsPerCampus: opts.studentsPerCampus ?? 6 });
  return { app, prisma, kv, seeded };
}

export interface Res<T = any> { status: number; body: T; headers: Record<string, any>; raw: string }

export class Client {
  cookie = '';
  constructor(private readonly app: NestFastifyApplication, public readonly email = '') {}
  async req<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
    const r = await this.app.getHttpAdapter().getInstance().inject({ method: method as never, url: `/api${url}`, payload: body as never, headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...headers } });
    let parsed: any = r.body;
    try { parsed = JSON.parse(r.body); } catch { /* text */ }
    return { status: r.statusCode, body: parsed, headers: r.headers, raw: r.body };
  }
  get = <T = any>(url: string) => this.req<T>('GET', url);
  post = <T = any>(url: string, body?: unknown) => this.req<T>('POST', url, body ?? {});
  put = <T = any>(url: string, body?: unknown) => this.req<T>('PUT', url, body ?? {});
  patch = <T = any>(url: string, body?: unknown) => this.req<T>('PATCH', url, body ?? {});
  del = <T = any>(url: string) => this.req<T>('DELETE', url);
  async login(password = DEMO_PASSWORD) {
    const r = await this.req('POST', '/auth/login', { email: `${this.email}@${DOMAIN}`, password });
    const sc = r.headers['set-cookie'];
    const raw = Array.isArray(sc) ? sc[0] : sc;
    if (raw) this.cookie = String(raw).split(';')[0]!;
    return r;
  }
}

export async function as(ctx: Ctx, local: string): Promise<Client> {
  const c = new Client(ctx.app, local);
  const r = await c.login();
  if (r.status !== 200) throw new Error(`login failed for ${local}: ${r.status} ${r.raw}`);
  return c;
}

export const cid = () => 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

/** Starts the live demo exam for a student, returns what the browser would hold. */
export async function startExam(ctx: Ctx, student: Client, clientId = cid(), examId = ctx.seeded.examId) {
  const r = await student.post('/attempts/start', { examId, clientId });
  if (r.status !== 200) throw new Error(`start failed ${r.status} ${r.raw}`);
  return { clientId, attemptId: r.body.attempt.id as string, questions: r.body.questions as { id: string; options: { label: string }[] }[], res: r };
}

export const save = (c: Client, attemptId: string, qid: string, clientId: string, revision: number, label: string | null, extra: Record<string, unknown> = {}) =>
  c.put(`/attempts/${attemptId}/answers/${qid}`, { clientId, revision, selectedLabel: label, state: label ? 'ANSWERED' : 'SKIPPED', markedForReview: false, visited: true, ...extra });
