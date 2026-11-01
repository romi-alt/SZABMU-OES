import { Injectable } from '@nestjs/common';
import { LINKS } from '@oes/shared';
import { Prisma } from '../../generated/prisma/client';
import type { AuthUser } from '../../common/auth';
import { AppError, badRequest, conflict, notFound } from '../../common/errors';
import { MetricsService } from '../../infra/metrics.service';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExamEventsService } from './events.service';
import { availableCommands, TRANSITIONS, type Command, type ExamState } from './exam-state';
import { LifecycleService } from './lifecycle.service';
import { MonitorService } from './monitor.service';
import { finishTransition, type FinishSpec } from './transition';

interface ExamRow { id: string; code: string; title: string; status: ExamState; controlMode: 'AUTOMATIC' | 'MANUAL'; timingPolicy: 'INDIVIDUAL' | 'SYNCHRONIZED'; suspendTimePolicy: 'FREEZE_CLOCK' | 'CLOCK_CONTINUES' | null;
  stateVersion: number; opensAt: Date; closesAt: Date; durationMin: number; paperStatus: string; officialStartAt: Date | null; admissionClosedAt: Date | null; forceCloseAt: Date | null; now: Date }
interface Outcome { changed: boolean; result?: Record<string, unknown>; finish?: Omit<FinishSpec, 'examId' | 'actor' | 'ip'>; after?: () => Promise<unknown> }
type Tx = Prisma.TransactionClient;
export interface CommandInput { idempotencyKey?: string; expectedVersion?: number; ip?: string }
export type SuspendInput = { scope: 'EXAM' | 'CAMPUS' | 'CANDIDATES'; institutionId?: string; studentIds?: string[]; reason: string; incidentId?: string; confirm: boolean };
export type ExtendInput = { scope: 'EXAM' | 'CAMPUS' | 'CANDIDATES'; institutionId?: string; studentIds?: string[]; minutes: number; reason: string; confirm: boolean };

const LOCK_COLS = Prisma.sql`id, code, title, status::text AS status, "controlMode"::text AS "controlMode", "timingPolicy"::text AS "timingPolicy", "suspendTimePolicy"::text AS "suspendTimePolicy", "stateVersion", "opensAt", "closesAt", "durationMin", "paperStatus"::text AS "paperStatus", "officialStartAt", "admissionClosedAt", "forceCloseAt", clock_timestamp() AS now`;

/**
 * Central exam control. Every command is ONE transaction: lock the exam row → verify state/preconditions → guarded updates →
 * (version bump + outbox event + audit record, all in that same transaction) → idempotency ledger. Concurrent commands serialise on the
 * row lock, so the second one sees the first one's result and either no-ops or is refused. Deadlines and times come from the database clock.
 */
@Injectable()
export class ExamControlService {
  constructor(
    private readonly prisma: PrismaService, readonly audit: AuditService, readonly events: ExamEventsService, private readonly lifecycle: LifecycleService,
    private readonly monitor: MonitorService, private readonly notifications: NotificationsService, private readonly metrics: MetricsService, private readonly redis: RedisService,
  ) {}

  // ───────────── command runner ─────────────
  private async command(u: AuthUser, examId: string, command: Command, input: CommandInput, fn: (c: { tx: Tx; exam: ExamRow; now: Date }) => Promise<Outcome>) {
    let after: (() => Promise<unknown>) | undefined; let payload: Record<string, unknown>;
    try {
      payload = await this.prisma.$transaction(async (tx) => {
        const exam = (await tx.$queryRaw<ExamRow[]>`SELECT ${LOCK_COLS} FROM exams WHERE id = ${examId}::uuid FOR UPDATE`)[0];
        if (!exam) throw notFound('Exam');
        if (input.idempotencyKey) {
          const prev = await tx.examCommand.findUnique({ where: { examId_idempotencyKey: { examId, idempotencyKey: input.idempotencyKey } } });
          if (prev) { if (prev.command !== command) throw conflict('KEY_REUSED', 'This idempotency key was used for a different command'); return { ...(prev.result as Record<string, unknown>), replayed: true }; }
        }
        if (input.expectedVersion !== undefined && input.expectedVersion !== exam.stateVersion) throw conflict('STALE_STATE', 'The examination changed since you loaded it. Review the current state and retry.', { currentVersion: exam.stateVersion, status: exam.status });
        const o = await fn({ tx, exam, now: exam.now });
        let version = exam.stateVersion;
        if (o.changed && o.finish) version = await finishTransition(tx, this, { examId, actor: u, ip: input.ip, ...o.finish });
        const out = { command, changed: o.changed, version, ...(o.result ?? {}) };
        if (input.idempotencyKey) await tx.examCommand.create({ data: { examId, idempotencyKey: input.idempotencyKey, command, actorId: u.id, result: out as never } });
        after = o.after;
        return out;
      }, { maxWait: 10_000, timeout: 60_000 });
    } catch (e) { this.metrics.controlCommands.inc({ command, outcome: e instanceof AppError ? 'refused' : 'error' }); throw e; }
    this.metrics.controlCommands.inc({ command, outcome: payload.replayed ? 'replayed' : payload.changed ? 'applied' : 'noop' });
    if (payload.changed) this.events.nudge();
    if (after) await after().catch(() => undefined);
    return { ...payload, state: await this.stateOf(examId) };
  }

  async stateOf(examId: string) {
    const r = (await this.prisma.$queryRaw<{ status: string; stateVersion: number; admissionClosedAt: Date | null; officialStartAt: Date | null; closesAt: Date; suspendTimePolicy: string | null; timingPolicy: string; controlMode: string }[]>`
      SELECT status::text AS status, "stateVersion", "admissionClosedAt", "officialStartAt", "closesAt", "suspendTimePolicy"::text AS "suspendTimePolicy", "timingPolicy"::text AS "timingPolicy", "controlMode"::text AS "controlMode" FROM exams WHERE id = ${examId}::uuid`)[0];
    if (!r) throw notFound('Exam');
    return r;
  }

  // ───────────── shared preconditions ─────────────
  /** Everything that must be true before candidates may enter; ALL failures are reported at once. */
  private async assertReady(tx: Tx, e: ExamRow, now: Date) {
    const [q, c] = await Promise.all([
      tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM exam_questions WHERE "examId" = ${e.id}::uuid`,
      tx.$queryRaw<{ total: number; admitted: number }[]>`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'ADMITTED')::int AS admitted FROM exam_candidates WHERE "examId" = ${e.id}::uuid`,
    ]);
    const failed: string[] = [];
    if (e.paperStatus !== 'APPROVED') failed.push('The question paper is not approved');
    if (!q[0]!.n) failed.push('The paper has no questions');
    if (!c[0]!.total) failed.push('No candidate roster is assigned');
    else if (!c[0]!.admitted) failed.push('No candidate is eligible (admitted) on the roster');
    if (now >= e.closesAt) failed.push('The examination window has ended');
    if (failed.length) throw conflict('PRECONDITION_FAILED', failed.join('; '), { failed });
  }
  private badState(command: Command, e: ExamRow) { return conflict('BAD_STATE', `${command.replace(/_/g, ' ').toLowerCase()} is not allowed while the examination is ${e.status}`, { status: e.status, allowedFrom: TRANSITIONS[command].from }); }
  private scopeSql(scope: 'EXAM' | 'CAMPUS' | 'CANDIDATES', institutionId?: string, studentIds?: string[]) {
    return scope === 'EXAM' ? Prisma.empty : scope === 'CAMPUS' ? Prisma.sql`AND a."studentId" IN (SELECT id FROM students WHERE "institutionId" = ${institutionId}::uuid)` : Prisma.sql`AND a."studentId" = ANY(${studentIds ?? []}::uuid[])`;
  }
  private async assertScope(tx: Tx, examId: string, scope: 'EXAM' | 'CAMPUS' | 'CANDIDATES', institutionId?: string, studentIds?: string[]) {
    if (scope === 'CAMPUS') {
      if (!institutionId) throw badRequest('institutionId is required for a campus scope');
      if (!(await tx.examInstitution.count({ where: { examId, institutionId } }))) throw badRequest('That campus does not participate in this examination');
    }
    if (scope === 'CANDIDATES') {
      if (!studentIds?.length) throw badRequest('Select at least one candidate');
      const n = await tx.examCandidate.count({ where: { examId, studentId: { in: studentIds } } });
      if (n !== new Set(studentIds).size) throw badRequest('One or more selected candidates are not on this examination roster');
    }
  }

  // ───────────── commands ─────────────
  openAdmission(u: AuthUser, examId: string, i: CommandInput) {
    return this.command(u, examId, 'OPEN_ADMISSION', i, async ({ tx, exam, now }) => {
      const s = exam.status; const open = s === 'ADMISSION_OPEN' || ((s === 'LIVE' || s === 'SUSPENDED') && !exam.admissionClosedAt);
      if (open) return { changed: false, result: { note: 'Admission is already open' } };
      if (s === 'SCHEDULED') {
        await this.assertReady(tx, exam, now);
        await tx.$executeRaw`UPDATE exams SET status = 'ADMISSION_OPEN', "admissionOpenedAt" = ${now}, "admissionClosedAt" = NULL WHERE id = ${exam.id}::uuid`;
        return { changed: true, finish: { action: 'exam.control.open_admission', meta: { from: s, to: 'ADMISSION_OPEN' }, events: [{ type: 'ADMISSION_OPENED', payload: { from: s } }] } };
      }
      if ((s === 'LIVE' || s === 'SUSPENDED') && exam.admissionClosedAt) {
        if (now >= exam.closesAt) throw conflict('PRECONDITION_FAILED', 'The examination window has ended');
        await tx.$executeRaw`UPDATE exams SET "admissionClosedAt" = NULL WHERE id = ${exam.id}::uuid`;
        return { changed: true, finish: { action: 'exam.control.open_admission', meta: { from: s, reopened: true }, events: [{ type: 'ADMISSION_OPENED', payload: { reopened: true } }] } };
      }
      throw this.badState('OPEN_ADMISSION', exam);
    });
  }

  closeAdmission(u: AuthUser, examId: string, i: CommandInput) {
    return this.command(u, examId, 'CLOSE_ADMISSION', i, async ({ tx, exam, now }) => {
      const s = exam.status;
      if (s === 'ADMISSION_OPEN') {
        await tx.$executeRaw`UPDATE exams SET status = 'SCHEDULED', "admissionClosedAt" = ${now} WHERE id = ${exam.id}::uuid`;
        return { changed: true, finish: { action: 'exam.control.close_admission', meta: { from: s, to: 'SCHEDULED' }, events: [{ type: 'ADMISSION_CLOSED', payload: {} }] } };
      }
      if ((s === 'LIVE' || s === 'SUSPENDED') && !exam.admissionClosedAt) {
        await tx.$executeRaw`UPDATE exams SET "admissionClosedAt" = ${now} WHERE id = ${exam.id}::uuid`;
        return { changed: true, finish: { action: 'exam.control.close_admission', meta: { from: s }, events: [{ type: 'ADMISSION_CLOSED', payload: {} }] } };
      }
      if (['SCHEDULED', 'LIVE', 'SUSPENDED', 'CLOSING', 'CLOSED', 'SCORING', 'RESULT_PENDING', 'PUBLISHED'].includes(s)) return { changed: false, result: { note: 'Admission is not open' } };
      throw this.badState('CLOSE_ADMISSION', exam);
    });
  }

  start(u: AuthUser, examId: string, i: CommandInput & { extendWindow?: boolean }) {
    return this.command(u, examId, 'START', i, async ({ tx, exam, now }) => {
      const s = exam.status;
      if (s === 'LIVE') return { changed: false, result: { note: 'The examination is already in progress', officialStartAt: exam.officialStartAt } };
      if (s !== 'SCHEDULED' && s !== 'ADMISSION_OPEN') throw this.badState('START', exam);
      if (s === 'SCHEDULED' && exam.admissionClosedAt) throw conflict('ADMISSION_CLOSED', 'Admission was closed. Open admission first.');
      await this.assertReady(tx, exam, now);
      let closesAt = exam.closesAt; let extendedWindow = false;
      if (exam.timingPolicy === 'SYNCHRONIZED') {
        const end = new Date(now.getTime() + exam.durationMin * 60_000);
        if (end > exam.closesAt) {
          if (!i.extendWindow) throw conflict('WINDOW_TOO_SHORT', `Starting now ends at ${end.toISOString()}, after the window end ${exam.closesAt.toISOString()}. Confirm to extend the window.`, { wouldEndAt: end.toISOString(), windowEnd: exam.closesAt.toISOString() });
          closesAt = end; extendedWindow = true;
        }
      }
      await tx.$executeRaw`UPDATE exams SET status = 'LIVE', "officialStartAt" = ${now}, "admissionOpenedAt" = COALESCE("admissionOpenedAt", ${now}), "closesAt" = ${closesAt} WHERE id = ${exam.id}::uuid`;
      return { changed: true, result: { officialStartAt: now }, finish: { action: 'exam.control.start', meta: { from: s, timingPolicy: exam.timingPolicy, extendedWindow, closesAt }, events: [{ type: 'EXAM_STARTED', payload: { timingPolicy: exam.timingPolicy, officialStartAt: now.toISOString() } }] } };
    });
  }

  suspend(u: AuthUser, examId: string, d: SuspendInput, i: CommandInput) {
    if (!d.confirm) throw badRequest('Explicit confirmation is required to suspend an examination');
    return this.command(u, examId, 'SUSPEND', i, async ({ tx, exam, now }) => {
      if (!exam.suspendTimePolicy) throw conflict('POLICY_NOT_APPROVED', 'The suspension time policy has not been approved for this examination. An authorised approver must set it first.');
      const open = await tx.examSuspension.findMany({ where: { examId: exam.id, resumedAt: null } });
      const same = open.find((s) => s.scope === d.scope && (s.institutionId ?? null) === (d.institutionId ?? null) && [...s.studentIds].sort().join() === [...(d.studentIds ?? [])].sort().join());
      if (same) return { changed: false, result: { note: 'This scope is already suspended', suspensionId: same.id } };
      if (exam.status !== 'LIVE') { if (exam.status === 'SUSPENDED') throw conflict('ALREADY_SUSPENDED', 'The whole examination is already suspended'); throw this.badState('SUSPEND', exam); }
      await this.assertScope(tx, exam.id, d.scope, d.institutionId, d.studentIds);
      if (d.incidentId && !(await tx.incident.count({ where: { id: d.incidentId, examId: exam.id } }))) throw badRequest('That incident does not belong to this examination');
      const sus = await tx.examSuspension.create({ data: { examId: exam.id, scope: d.scope, institutionId: d.institutionId ?? null, studentIds: d.studentIds ?? [], reason: d.reason, incidentId: d.incidentId ?? null, timePolicy: exam.suspendTimePolicy, suspendedBy: u.id, suspendedAt: now } });
      const hit = await tx.$queryRaw<{ id: string }[]>`
        WITH upd AS (UPDATE attempts a SET "suspendedAt" = ${now}, "suspensionId" = ${sus.id}::uuid WHERE a."examId" = ${exam.id}::uuid AND a.status = 'IN_PROGRESS' AND a."suspendedAt" IS NULL ${this.scopeSql(d.scope, d.institutionId, d.studentIds)} RETURNING a.id),
             ev AS (INSERT INTO attempt_events ("attemptId", kind, "actorId", detail) SELECT id, 'SUSPENDED', ${u.id}::uuid, ${JSON.stringify({ suspensionId: sus.id, scope: d.scope, policy: exam.suspendTimePolicy })}::jsonb FROM upd RETURNING 1)
        SELECT id FROM upd`;
      await tx.examSuspension.update({ where: { id: sus.id }, data: { affectedCount: hit.length } });
      if (d.scope === 'EXAM') await tx.$executeRaw`UPDATE exams SET status = 'SUSPENDED' WHERE id = ${exam.id}::uuid`;
      const ids = d.scope === 'CANDIDATES' && (d.studentIds?.length ?? 0) <= 500 ? { studentIds: d.studentIds } : {};
      return { changed: true, result: { suspensionId: sus.id, affected: hit.length, timePolicy: exam.suspendTimePolicy },
        finish: { action: 'exam.control.suspend', meta: { scope: d.scope, institutionId: d.institutionId, candidates: d.studentIds?.length, reason: d.reason, incidentId: d.incidentId, timePolicy: exam.suspendTimePolicy, affected: hit.length, suspensionId: sus.id }, events: [{ type: 'EXAM_SUSPENDED', institutionId: d.scope === 'CAMPUS' ? d.institutionId : null, payload: { suspensionId: sus.id, scope: d.scope, timePolicy: exam.suspendTimePolicy, ...ids } }] },
        after: () => this.notifyAttempts(hit.map((h) => h.id), 'Examination suspended', 'Your examination has been suspended by the examination office. Your saved answers are safe. Wait for instructions; do not close this window.') };
    });
  }

  resume(u: AuthUser, examId: string, d: { suspensionId?: string; note?: string; confirm: boolean }, i: CommandInput) {
    if (!d.confirm) throw badRequest('Explicit confirmation is required to resume an examination');
    return this.command(u, examId, 'RESUME', i, async ({ tx, exam, now }) => {
      const open = await tx.examSuspension.findMany({ where: { examId: exam.id, resumedAt: null }, orderBy: { suspendedAt: 'asc' } });
      const target = d.suspensionId ? open.find((s) => s.id === d.suspensionId) : exam.status === 'SUSPENDED' ? open.find((s) => s.scope === 'EXAM') : open.length === 1 ? open[0] : undefined;
      if (!target) {
        if (d.suspensionId) { const done = await tx.examSuspension.findFirst({ where: { id: d.suspensionId, examId: exam.id } }); if (!done) throw notFound('Suspension'); return { changed: false, result: { note: 'This suspension was already resumed', suspensionId: done.id } }; }
        if (open.length > 1) throw conflict('AMBIGUOUS', 'Several suspensions are open; name the one to resume', { open: open.map((s) => ({ id: s.id, scope: s.scope, institutionId: s.institutionId })) });
        return { changed: false, result: { note: 'Nothing is suspended' } };
      }
      const frozen = target.timePolicy === 'FREEZE_CLOCK';
      const paused = Math.max(0, Math.floor((now.getTime() - target.suspendedAt.getTime()) / 1000));
      // Each attempt gains ITS OWN paused duration; sealed attempts are untouched (status = 'IN_PROGRESS' predicate).
      const hit = await tx.$queryRaw<{ id: string }[]>`
        WITH upd AS (UPDATE attempts SET "deadlineAt" = "deadlineAt" + (CASE WHEN ${frozen} THEN ${now}::timestamptz - "suspendedAt" ELSE interval '0' END), "suspendedAt" = NULL, "suspensionId" = NULL
                     WHERE "suspensionId" = ${target.id}::uuid AND status = 'IN_PROGRESS' RETURNING id),
             ev AS (INSERT INTO attempt_events ("attemptId", kind, "actorId", detail) SELECT id, 'RESUMED', ${u.id}::uuid, ${JSON.stringify({ suspensionId: target.id, pausedSeconds: frozen ? paused : 0, policy: target.timePolicy })}::jsonb FROM upd RETURNING 1)
        SELECT id FROM upd`;
      await tx.examSuspension.update({ where: { id: target.id }, data: { resumedBy: u.id, resumedAt: now, resumeNote: d.note ?? null, pausedSeconds: frozen ? paused : 0 } });
      if (target.scope === 'EXAM') await tx.$executeRaw`UPDATE exams SET status = 'LIVE', "closesAt" = "closesAt" + make_interval(secs => ${frozen ? paused : 0}::int) WHERE id = ${exam.id}::uuid`;
      return { changed: true, result: { suspensionId: target.id, resumed: hit.length, pausedSeconds: frozen ? paused : 0, timePolicy: target.timePolicy },
        finish: { action: 'exam.control.resume', meta: { suspensionId: target.id, scope: target.scope, pausedSeconds: frozen ? paused : 0, timePolicy: target.timePolicy, resumed: hit.length, note: d.note }, events: [{ type: 'EXAM_RESUMED', institutionId: target.scope === 'CAMPUS' ? target.institutionId : null, payload: { suspensionId: target.id, scope: target.scope, pausedSeconds: frozen ? paused : 0, ...(target.scope === 'CANDIDATES' && target.studentIds.length <= 500 ? { studentIds: target.studentIds } : {}) } }] },
        after: () => this.notifyAttempts(hit.map((h) => h.id), 'Examination resumed', 'Your examination has resumed. Your saved answers are intact and your remaining time is shown on screen.') };
    });
  }

  /** Read-only: who would be affected and what their deadlines become. */
  async previewExtension(u: AuthUser, examId: string, d: Pick<ExtendInput, 'scope' | 'institutionId' | 'studentIds' | 'minutes'>) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId }, select: { id: true, status: true, closesAt: true, stateVersion: true } });
    if (!exam) throw notFound('Exam');
    await this.assertScope(this.prisma as unknown as Tx, examId, d.scope, d.institutionId, d.studentIds);
    const r = (await this.prisma.$queryRaw<{ n: number; lo: Date | null; hi: Date | null; suspended: number }[]>`
      SELECT count(*)::int AS n, min(a."deadlineAt") AS lo, max(a."deadlineAt") AS hi, count(*) FILTER (WHERE a."suspendedAt" IS NOT NULL)::int AS suspended
      FROM attempts a WHERE a."examId" = ${examId}::uuid AND a.status = 'IN_PROGRESS' ${this.scopeSql(d.scope, d.institutionId, d.studentIds)}`)[0]!;
    const add = (t: Date | null) => (t ? new Date(t.getTime() + d.minutes * 60_000).toISOString() : null);
    return { examStatus: exam.status, stateVersion: exam.stateVersion, serverNow: new Date().toISOString(), scope: d.scope, minutes: d.minutes, affected: r.n, ofWhichSuspended: r.suspended,
      currentEarliestDeadline: r.lo, currentLatestDeadline: r.hi, newEarliestDeadline: add(r.lo), newLatestDeadline: add(r.hi),
      windowEnd: { current: exam.closesAt, after: d.scope === 'EXAM' ? new Date(exam.closesAt.getTime() + d.minutes * 60_000).toISOString() : exam.closesAt } };
  }

  extend(u: AuthUser, examId: string, d: ExtendInput, i: CommandInput) {
    if (!d.confirm) throw badRequest('Explicit confirmation is required to extend an examination');
    if (!i.idempotencyKey) throw badRequest('idempotencyKey is required: a retried request must not extend twice');
    return this.command(u, examId, 'EXTEND', i, async ({ tx, exam }) => {
      if (!['LIVE', 'SUSPENDED', 'CLOSING'].includes(exam.status)) throw this.badState('EXTEND', exam);
      await this.assertScope(tx, exam.id, d.scope, d.institutionId, d.studentIds);
      // One atomic UPDATE: row locks make this serialise with an auto-submit of the same attempt; a sealed attempt no longer matches status='IN_PROGRESS'.
      const hit = await tx.$queryRaw<{ id: string }[]>`
        WITH upd AS (UPDATE attempts a SET "deadlineAt" = a."deadlineAt" + make_interval(mins => ${d.minutes}::int), "extraTimeMin" = a."extraTimeMin" + ${d.minutes}::int
                     WHERE a."examId" = ${exam.id}::uuid AND a.status = 'IN_PROGRESS' ${this.scopeSql(d.scope, d.institutionId, d.studentIds)} RETURNING a.id),
             ev AS (INSERT INTO attempt_events ("attemptId", kind, "actorId", detail) SELECT id, 'TIME_EXTENDED', ${u.id}::uuid, ${JSON.stringify({ minutes: d.minutes, reason: d.reason, scope: d.scope, group: true })}::jsonb FROM upd RETURNING 1)
        SELECT id FROM upd`;
      if (!hit.length && d.scope !== 'EXAM') throw conflict('NO_ACTIVE_ATTEMPTS', 'None of the selected candidates has an attempt in progress, so there is nothing to extend');
      let closesAfter: Date | null = null;
      if (d.scope === 'EXAM') closesAfter = (await tx.$queryRaw<{ c: Date }[]>`UPDATE exams SET "closesAt" = "closesAt" + make_interval(mins => ${d.minutes}::int) WHERE id = ${exam.id}::uuid RETURNING "closesAt" AS c`)[0]!.c;
      await tx.examExtension.create({ data: { examId: exam.id, scope: d.scope, institutionId: d.institutionId ?? null, studentIds: d.studentIds ?? [], minutes: d.minutes, reason: d.reason, approvedBy: u.id, idempotencyKey: i.idempotencyKey!, affectedCount: hit.length, closesAtBefore: d.scope === 'EXAM' ? exam.closesAt : null, closesAtAfter: closesAfter } });
      const ids = d.scope === 'CANDIDATES' && (d.studentIds?.length ?? 0) <= 500 ? { studentIds: d.studentIds } : {};
      return { changed: true, result: { affected: hit.length, minutes: d.minutes, scope: d.scope, closesAt: closesAfter ?? exam.closesAt },
        finish: { action: 'exam.control.extend', meta: { scope: d.scope, institutionId: d.institutionId, candidates: d.studentIds?.length, minutes: d.minutes, reason: d.reason, affected: hit.length, approvedBy: u.id, idempotencyKey: i.idempotencyKey }, events: [{ type: 'DEADLINE_EXTENDED', institutionId: d.scope === 'CAMPUS' ? d.institutionId : null, payload: { scope: d.scope, minutes: d.minutes, ...ids } }] },
        after: () => this.notifyAttempts(hit.map((h) => h.id), 'Examination time extended', `You have been given ${d.minutes} additional minutes. Your remaining time is shown on screen.`) };
    });
  }

  close(u: AuthUser, examId: string, d: { force?: boolean; reason?: string }, i: CommandInput) {
    if (d.force && (d.reason?.trim().length ?? 0) < 10) throw badRequest('A reason (at least 10 characters) is required to force-close an examination');
    return this.command(u, examId, 'CLOSE', i, async ({ tx, exam, now }) => {
      const s = exam.status;
      if (['CLOSED', 'SCORING', 'RESULT_PENDING', 'PUBLISHED'].includes(s)) return { changed: false, result: { note: 'The examination is already closed' } };
      if (s === 'CLOSING') {
        if (d.force && !exam.forceCloseAt) {
          await tx.$executeRaw`UPDATE exams SET "forceCloseAt" = ${now} WHERE id = ${exam.id}::uuid`;
          return { changed: true, finish: { action: 'exam.control.close', meta: { escalatedToForce: true, reason: d.reason }, events: [{ type: 'EXAM_CLOSING', payload: { force: true } }] }, after: () => this.lifecycle.reconcileExam(exam.id) };
        }
        return { changed: false, result: { note: 'The examination is already closing' } };
      }
      if (!['ADMISSION_OPEN', 'LIVE', 'SUSPENDED'].includes(s)) throw this.badState('CLOSE', exam);
      if (s === 'SUSPENDED' && !d.force) throw conflict('RESUME_OR_FORCE', 'The examination is suspended. Resume it first, or force-close to seal every suspended attempt.');
      const inProgress = (await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM attempts WHERE "examId" = ${exam.id}::uuid AND status = 'IN_PROGRESS'`)[0]!.n;
      if (d.force) await tx.$executeRaw`UPDATE exam_suspensions SET "resumedAt" = ${now}, "resumedBy" = ${u.id}::uuid, "resumeNote" = 'closed by controller', "pausedSeconds" = 0 WHERE "examId" = ${exam.id}::uuid AND "resumedAt" IS NULL`;
      if (inProgress === 0) {
        await tx.$executeRaw`UPDATE exams SET status = 'CLOSED', "closedAt" = ${now}, "admissionClosedAt" = COALESCE("admissionClosedAt", ${now}) WHERE id = ${exam.id}::uuid`;
        return { changed: true, result: { inProgress: 0 }, finish: { action: 'exam.control.close', meta: { from: s, to: 'CLOSED', reason: d.reason }, events: [{ type: 'EXAM_CLOSED', payload: {} }] } };
      }
      await tx.$executeRaw`UPDATE exams SET status = 'CLOSING', "admissionClosedAt" = COALESCE("admissionClosedAt", ${now}), "forceCloseAt" = ${d.force ? now : null} WHERE id = ${exam.id}::uuid`;
      return { changed: true, result: { inProgress, force: !!d.force }, finish: { action: 'exam.control.close', meta: { from: s, to: 'CLOSING', inProgress, force: !!d.force, reason: d.reason }, events: [{ type: 'EXAM_CLOSING', payload: { inProgress, force: !!d.force } }] },
        after: d.force ? () => this.lifecycle.reconcileExam(exam.id) : undefined };
    });
  }

  initiateScoring(u: AuthUser, examId: string, i: CommandInput) {
    return this.command(u, examId, 'INITIATE_SCORING', i, async ({ tx, exam }) => {
      if (exam.status === 'SCORING') return { changed: false, result: { note: 'Scoring is already in progress' } };
      if (exam.status !== 'CLOSED') throw this.badState('INITIATE_SCORING', exam);
      const [live, roster] = await Promise.all([
        tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM attempts WHERE "examId" = ${exam.id}::uuid AND status = 'IN_PROGRESS'`,
        tx.examCandidate.count({ where: { examId: exam.id } }),
      ]);
      if (live[0]!.n > 0) throw conflict('ATTEMPTS_IN_PROGRESS', `${live[0]!.n} attempt(s) are still in progress. Reconcile attempts first.`, { inProgress: live[0]!.n });
      if (!roster) throw conflict('PRECONDITION_FAILED', 'There is no roster to score');
      await tx.$executeRaw`UPDATE exams SET status = 'SCORING' WHERE id = ${exam.id}::uuid`;
      return { changed: true, finish: { action: 'exam.control.initiate_scoring', meta: { from: 'CLOSED' }, events: [{ type: 'SCORING_STARTED', payload: {} }] }, after: () => this.lifecycle.reconcileExam(exam.id) };
    });
  }

  /** Runs the same reconciliation the background worker runs, for this exam now. No state is invented: it seals what the database says has expired. */
  async reconcile(u: AuthUser, examId: string, ip?: string) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId }, select: { status: true } });
    if (!exam) throw notFound('Exam');
    if (!['LIVE', 'SUSPENDED', 'CLOSING', 'CLOSED', 'SCORING'].includes(exam.status)) throw conflict('BAD_STATE', `Reconcile is not available while the examination is ${exam.status}`);
    const stats = await this.lifecycle.reconcileExam(examId);
    await this.audit.log({ actor: u, action: 'exam.control.reconcile', entity: 'exam', entityId: examId, meta: { ...stats }, ip });
    this.metrics.controlCommands.inc({ command: 'RECONCILE', outcome: 'applied' });
    return { command: 'RECONCILE', changed: stats.autoSubmitted + stats.closed + stats.graded + stats.forceSealed > 0, result: stats, state: await this.stateOf(examId) };
  }

  // ───────────── policy ─────────────
  /** Timing/control mode may change only before the exam starts; the suspension time policy needs an authorised approver (stamped). */
  async setPolicy(u: AuthUser, examId: string, d: { timingPolicy?: 'INDIVIDUAL' | 'SYNCHRONIZED'; controlMode?: 'AUTOMATIC' | 'MANUAL'; suspendTimePolicy?: 'FREEZE_CLOCK' | 'CLOCK_CONTINUES' }, ip?: string) {
    const out = await this.prisma.$transaction(async (tx) => {
      const exam = (await tx.$queryRaw<ExamRow[]>`SELECT ${LOCK_COLS} FROM exams WHERE id = ${examId}::uuid FOR UPDATE`)[0];
      if (!exam) throw notFound('Exam');
      if (!['DRAFT', 'PAPER_PENDING', 'APPROVED', 'SCHEDULED'].includes(exam.status)) throw conflict('BAD_STATE', `Policy cannot change while the examination is ${exam.status}`);
      if (await tx.attempt.count({ where: { examId } })) throw conflict('BAD_STATE', 'Policy cannot change once candidates have started');
      const data: Record<string, unknown> = {};
      if (d.timingPolicy) data.timingPolicy = d.timingPolicy;
      if (d.controlMode) data.controlMode = d.controlMode;
      if (d.suspendTimePolicy) { data.suspendTimePolicy = d.suspendTimePolicy; data.controlPolicyApprovedBy = u.id; data.controlPolicyApprovedAt = new Date(); }
      if (!Object.keys(data).length) throw badRequest('Nothing to change');
      await tx.exam.update({ where: { id: examId }, data: data as never });
      await finishTransition(tx, this, { examId, actor: u, ip, action: 'exam.control.policy', meta: { ...d, before: { timingPolicy: exam.timingPolicy, controlMode: exam.controlMode, suspendTimePolicy: exam.suspendTimePolicy } }, events: [{ type: 'POLICY_CHANGED', payload: { ...d } }] });
      return true;
    });
    void out; this.events.nudge();
    return { changed: true, state: await this.stateOf(examId) };
  }

  // ───────────── read model for the control centre ─────────────
  async view(u: AuthUser, examId: string) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId }, include: { course: { include: { program: { select: { code: true, name: true } } } }, _count: { select: { questions: true } } } });
    if (!exam) throw notFound('Exam');
    const [viewer, suspensions, extensions, recent, paper, lifecycle, outbox, approver] = await Promise.all([
      this.monitor.staffViewer(u, examId),
      this.prisma.examSuspension.findMany({ where: { examId }, orderBy: { suspendedAt: 'desc' }, take: 50 }),
      this.prisma.examExtension.findMany({ where: { examId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.examEvent.findMany({ where: { examId }, orderBy: { id: 'desc' }, take: 30 }),
      this.prisma.$queryRaw<{ fp: string | null }[]>`SELECT md5(string_agg(id::text, ',' ORDER BY position)) AS fp FROM exam_questions WHERE "examId" = ${examId}::uuid`,
      this.lifecycle.health(), this.events.outboxStats(),
      exam.controlPolicyApprovedBy ? this.prisma.user.findUnique({ where: { id: exam.controlPolicyApprovedBy }, select: { fullName: true } }) : Promise.resolve(null),
    ]);
    const snapshot = await this.monitor.snapshot(viewer, examId);
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set([...suspensions.flatMap((s) => [s.suspendedBy, s.resumedBy]), ...extensions.map((x) => x.approvedBy)].filter(Boolean) as string[])] } }, select: { id: true, fullName: true } })).map((x) => [x.id, x.fullName]));
    const openSuspensions = suspensions.filter((s) => !s.resumedAt);
    const m = this.metrics; const saves = m.saves.total(); const saveOk = m.saves.value({ result: 'ok' }); const saveErr = m.saves.value({ result: 'error' });
    return {
      exam: { id: exam.id, code: exam.code, title: exam.title, subject: exam.course.title, courseCode: exam.course.code, program: exam.course.program, opensAt: exam.opensAt, closesAt: exam.closesAt, durationMin: exam.durationMin, status: exam.status, stateVersion: exam.stateVersion,
        timingPolicy: exam.timingPolicy, controlMode: exam.controlMode, suspendTimePolicy: exam.suspendTimePolicy, suspendPolicyApprovedBy: approver?.fullName ?? null, suspendPolicyApprovedAt: exam.controlPolicyApprovedAt,
        officialStartAt: exam.officialStartAt, admissionClosedAt: exam.admissionClosedAt, closedAt: exam.closedAt,
        paper: { status: exam.paperStatus, approvedAt: exam.paperApprovedAt, questions: exam._count.questions, fingerprint: paper[0]?.fp?.slice(0, 12) ?? null } },
      commands: availableCommands({ status: exam.status as ExamState, admissionClosedAt: exam.admissionClosedAt, suspendTimePolicy: exam.suspendTimePolicy, openSuspensions: openSuspensions.length, examSuspended: exam.status === 'SUSPENDED' }),
      snapshot,
      suspensions: suspensions.map((s) => ({ ...s, suspendedByName: names.get(s.suspendedBy) ?? null, resumedByName: s.resumedBy ? names.get(s.resumedBy) ?? null : null })),
      extensions: extensions.map((x) => ({ ...x, approvedByName: names.get(x.approvedBy) ?? null })),
      recentEvents: recent.map((e) => ({ id: Number(e.id), type: e.type, version: e.aggregateVersion, at: e.createdAt, delivery: e.deliveryStatus, institutionId: e.institutionId })),
      health: {
        monitoringUpdatedAt: snapshot.freshness.computedAt,
        redis: { available: this.redis.available, eventChannel: this.events.redisSubscriberUp },
        lifecycle, outbox,
        sseSubscribersThisInstance: this.events.subscriberCount,
        saves: { scope: 'this API instance, since process start', total: saves, ok: saveOk, errors: saveErr, successRate: saves ? Math.round((saveOk / saves) * 10000) / 100 : null, p95Seconds: m.saveDuration.quantile(0.95) },
        apiErrors: { scope: 'this API instance, since process start', http5xx: m.http.total((l) => /^5/.test(l.status ?? '')), unhandled: m.unhandled.value() },
      },
    };
  }

  private async notifyAttempts(attemptIds: string[], title: string, body: string) {
    if (!attemptIds.length) return;
    const users = await this.prisma.$queryRaw<{ userId: string }[]>`SELECT s."userId" FROM attempts a JOIN students s ON s.id = a."studentId" WHERE a.id = ANY(${attemptIds}::uuid[])`;
    await this.notifications.notify(users.map((x) => x.userId), title, body, LINKS.schedule);
  }
}
