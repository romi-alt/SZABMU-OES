import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Perm, type AuthUser } from '../../common/auth';
import { AppError } from '../../common/errors';
import { parse, uuid } from '../../common/validate';
import { PrismaService } from '../../infra/prisma.service';
import { ExamControlService } from './control.service';
import { ExamEventsService, type ExamEvent, type Viewer } from './events.service';
import { CANDIDATE_STATUS, MonitorService } from './monitor.service';

const base = { idempotencyKey: z.string().min(8).max(64).optional(), expectedVersion: z.number().int().min(0).optional() };
const cmd = z.object(base);
const reason = z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500);
const scopeFields = { scope: z.enum(['EXAM', 'CAMPUS', 'CANDIDATES']), institutionId: uuid.optional(), studentIds: z.array(uuid).max(5000).optional() };
const suspendDto = z.object({ ...base, ...scopeFields, reason, incidentId: uuid.optional(), confirm: z.boolean() });
const resumeDto = z.object({ ...base, suspensionId: uuid.optional(), note: z.string().trim().max(500).optional(), confirm: z.boolean() });
const extendFields = { ...scopeFields, minutes: z.number().int().min(1).max(240) };
const extendDto = z.object({ ...base, ...extendFields, reason, confirm: z.boolean() });
const previewDto = z.object(extendFields);
const closeDto = z.object({ ...base, force: z.boolean().optional(), reason: z.string().trim().max(500).optional() });
const startDto = z.object({ ...base, extendWindow: z.boolean().optional() });
const policyDto = z.object({ timingPolicy: z.enum(['INDIVIDUAL', 'SYNCHRONIZED']).optional(), controlMode: z.enum(['AUTOMATIC', 'MANUAL']).optional(), suspendTimePolicy: z.enum(['FREEZE_CLOCK', 'CLOCK_CONTINUES']).optional() });
const candQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50), institutionId: uuid.optional(), status: z.enum(CANDIDATE_STATUS).optional(), search: z.string().max(60).optional() });

const MAX_STREAMS_PER_USER = Number(process.env.SSE_MAX_PER_USER ?? 4); const MAX_STREAMS_PER_PROCESS = Number(process.env.SSE_MAX_PER_PROCESS ?? 20000);   // per-user cap protects one account from exhausting sockets; raise for shared operations desks
const perUser = new Map<string, number>(); let openStreams = 0;

@Controller()
export class ExamControlController {
  constructor(private readonly control: ExamControlService, private readonly monitor: MonitorService, private readonly events: ExamEventsService, private readonly prisma: PrismaService) {}

  // ───────────── central command centre (exam-wide authority) ─────────────
  @Perm('exam.control.view') @Get('exams/:id/control')
  view(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.control.view(u, id); }

  @Perm('exam.control.policy') @Post('exams/:id/control/policy') @HttpCode(200)
  policy(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.control.setPolicy(u, id, parse(policyDto, b), ip); }

  @Perm('exam.control') @Post('exams/:id/control/open-admission') @HttpCode(200)
  open(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.control.openAdmission(u, id, { ...parse(cmd, b ?? {}), ip }); }
  @Perm('exam.control') @Post('exams/:id/control/close-admission') @HttpCode(200)
  closeAdm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.control.closeAdmission(u, id, { ...parse(cmd, b ?? {}), ip }); }
  @Perm('exam.control') @Post('exams/:id/control/start') @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(startDto, b ?? {}); return this.control.start(u, id, { ...d, ip }); }
  @Perm('exam.control') @Post('exams/:id/control/suspend') @HttpCode(200)
  suspend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(suspendDto, b); return this.control.suspend(u, id, d, { idempotencyKey: d.idempotencyKey, expectedVersion: d.expectedVersion, ip }); }
  @Perm('exam.control') @Post('exams/:id/control/resume') @HttpCode(200)
  resume(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(resumeDto, b); return this.control.resume(u, id, d, { idempotencyKey: d.idempotencyKey, expectedVersion: d.expectedVersion, ip }); }
  @Perm('exam.control') @Post('exams/:id/control/extend/preview') @HttpCode(200)
  preview(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.control.previewExtension(u, id, parse(previewDto, b)); }
  @Perm('exam.control') @Post('exams/:id/control/extend') @HttpCode(200)
  extend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(extendDto, b); return this.control.extend(u, id, d, { idempotencyKey: d.idempotencyKey, expectedVersion: d.expectedVersion, ip }); }
  @Perm('exam.control') @Post('exams/:id/control/close') @HttpCode(200)
  close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { const d = parse(closeDto, b ?? {}); return this.control.close(u, id, d, { idempotencyKey: d.idempotencyKey, expectedVersion: d.expectedVersion, ip }); }
  @Perm('exam.control') @Post('exams/:id/control/reconcile') @HttpCode(200)
  reconcile(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Ip() ip: string) { return this.control.reconcile(u, id, ip); }
  @Perm('exam.control') @Post('exams/:id/control/initiate-scoring') @HttpCode(200)
  scoring(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @Ip() ip: string) { return this.control.initiateScoring(u, id, { ...parse(cmd, b ?? {}), ip }); }

  // ───────────── campus-scoped monitoring (also what the command centre reads) ─────────────
  @Perm('invigilation.monitor') @Get('invigilation/exams/:id/snapshot')
  async snapshot(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.monitor.snapshot(await this.monitor.staffViewer(u, id), id); }

  @Perm('invigilation.monitor') @Get('invigilation/exams/:id/candidates')
  async candidates(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: Record<string, string>) { return this.monitor.candidates(await this.monitor.staffViewer(u, id), id, parse(candQuery, q)); }

  @Perm('invigilation.monitor') @Get('invigilation/exams/:id/stream')
  async staffStream(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.stream(u, id, await this.monitor.staffViewer(u, id), true, req, reply);
  }

  // ───────────── the candidate's own view of the examination ─────────────
  @Perm('exam.sit') @Get('me/exams/:id/state')
  async myState(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.monitor.studentViewer(u, id);                                    // 404 unless on the roster
    const s = await this.control.stateOf(id);
    return { status: s.status, stateVersion: s.stateVersion, admissionOpen: s.status === 'ADMISSION_OPEN' || ((s.status === 'LIVE' || s.status === 'SUSPENDED') && !s.admissionClosedAt), officialStartAt: s.officialStartAt, timingPolicy: s.timingPolicy, serverNow: await this.prisma.dbNow() };
  }

  @Perm('exam.sit') @Get('me/exams/:id/stream')
  async studentStream(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.stream(u, id, await this.monitor.studentViewer(u, id), false, req, reply);
  }

  // ───────────── Server-Sent Events ─────────────
  /**
   * Replay-then-live without gaps: subscribe first (buffering), replay committed events after the client's cursor from PostgreSQL,
   * drain the buffer, replay once more, then go live. Every event carries its outbox id (the SSE `id:`), so a reconnecting browser sends
   * Last-Event-ID automatically and de-duplication is by id. Losing Redis only slows delivery: the hub also reads the database.
   */
  private async stream(u: AuthUser, examId: string, viewer: Viewer, staff: boolean, req: FastifyRequest, reply: FastifyReply) {
    if (openStreams >= MAX_STREAMS_PER_PROCESS || (perUser.get(u.id) ?? 0) >= MAX_STREAMS_PER_USER) throw new AppError(429, 'TOO_MANY_STREAMS', 'Too many open live connections');
    const q = req.query as { after?: string };
    const header = req.headers['last-event-id']; const after = Number(Array.isArray(header) ? header[0] : header ?? q.after ?? NaN);
    const resume = Number.isFinite(after) && after >= 0;
    const raw = reply.raw; reply.hijack();
    raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    openStreams++; perUser.set(u.id, (perUser.get(u.id) ?? 0) + 1);
    const write = (s: string) => { if (!raw.destroyed && !raw.writableEnded) raw.write(s); };
    const frame = (ev: ExamEvent) => write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify({ id: ev.id, type: ev.type, version: ev.version, payload: ev.payload, at: ev.at })}\n\n`);
    write('retry: 3000\n\n');
    let ready = false; let last = resume ? after : await this.events.latestId(examId); const buf: ExamEvent[] = [];
    let hb: NodeJS.Timeout | undefined; let sub: Awaited<ReturnType<ExamEventsService['subscribe']>> | undefined; let closed = false;
    const cleanup = () => { if (closed) return; closed = true; if (hb) clearInterval(hb); if (sub) this.events.unsubscribe(sub); openStreams--; const n = (perUser.get(u.id) ?? 1) - 1; if (n > 0) perUser.set(u.id, n); else perUser.delete(u.id); if (!raw.writableEnded) raw.end(); };
    req.raw.on('close', cleanup);
    try {
      sub = await this.events.subscribe(examId, viewer, last, (ev) => { if (ready) { if (ev.id > last) { last = ev.id; frame(ev); } } else buf.push(ev); }, cleanup);
      if (staff) sub.sendStats = (snap) => write(`event: stats\ndata: ${JSON.stringify(snap)}\n\n`);
      const drain = async () => { const r = await this.events.replay(examId, last, viewer); for (const ev of r.events) if (ev.id > last) { last = ev.id; frame(ev); } if (r.gap) write(`event: resync\ndata: {}\n\n`); };
      if (resume) await drain();
      for (const ev of buf.sort((a, b) => a.id - b.id)) if (ev.id > last) { last = ev.id; frame(ev); }
      buf.length = 0; await drain(); ready = true; sub.lastId = Math.max(sub.lastId, last);
      const st = await this.control.stateOf(examId);
      if (!staff) write(`event: state\ndata: ${JSON.stringify({ status: st.status, stateVersion: st.stateVersion })}\n\n`);
      else { sub.statsAt = 0; sub.statsKey = undefined; }                         // the next tick pushes the first snapshot
      hb = setInterval(() => write(': keep-alive\n\n'), 15_000); hb.unref();
    } catch (e) { cleanup(); throw e; }
  }
}
