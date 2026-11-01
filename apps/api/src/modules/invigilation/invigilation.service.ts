import { Injectable } from '@nestjs/common';
import { LINKS } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeliveryService } from '../delivery/delivery.service';
import { MonitorService } from '../control/monitor.service';
import { scope, type AuthUser } from '../../common/auth';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import type { Prisma } from '../../generated/prisma/client';

@Injectable()
export class InvigilationService {
  constructor(
    private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly audit: AuditService,
    private readonly notifications: NotificationsService, private readonly delivery: DeliveryService, private readonly monitorView: MonitorService,
  ) {}

  /** Institutions this user may monitor for a given exam. Invigilators: only where assigned (∩ their scope). */
  private async monitorScope(u: AuthUser, examId: string): Promise<string[] | null> {
    if (u.role === 'INVIGILATOR') {
      const rows = await this.prisma.examInvigilator.findMany({ where: { examId, userId: u.id } });
      const ids = rows.map((r) => r.institutionId).filter((i) => scope.allows(u, i));
      if (!ids.length) throw notFound('Exam');
      return ids;
    }
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, ...(u.institutionIds === null ? {} : { institutions: { some: { institutionId: { in: u.institutionIds } } } }) }, select: { id: true } });
    if (!exam) throw notFound('Exam');
    return u.institutionIds;
  }

  async duties(u: AuthUser) {
    const where: Prisma.ExamWhereInput = u.role === 'INVIGILATOR'
      ? { invigilators: { some: { userId: u.id } } }
      : u.institutionIds === null ? {} : { institutions: { some: { institutionId: { in: u.institutionIds } } } };
    return this.prisma.exam.findMany({ where: { ...where, status: { in: ['SCHEDULED', 'ADMISSION_OPEN', 'LIVE', 'SUSPENDED', 'CLOSING', 'CLOSED', 'SCORING'] } }, orderBy: { opensAt: 'asc' }, take: 50, include: { course: { select: { code: true, title: true } }, _count: { select: { candidates: true } } } });
  }

  /**
   * Backwards-compatible monitor response, now BOUNDED: aggregates come from the shared per-exam snapshot and candidates are one page
   * (≤ 100). The control centre uses /snapshot, /candidates and /stream directly.
   */
  async monitor(u: AuthUser, examId: string, q: { page?: number; pageSize?: number } = {}) {
    const viewer = await this.monitorView.staffViewer(u, examId);
    const [snap, page, total] = await Promise.all([
      this.monitorView.snapshot(viewer, examId),
      this.monitorView.candidates(viewer, examId, { page: q.page ?? 1, pageSize: q.pageSize ?? 100 }),
      this.prisma.examQuestion.count({ where: { examId } }),
    ]);
    const t = snap.totals;
    return {
      serverNow: snap.serverNow, status: snap.status, stateVersion: snap.stateVersion, freshness: snap.freshness, page: page.page, pageSize: page.pageSize, totalRows: page.total,
      summary: { candidates: t.allocated, notStarted: t.allocated - t.admitted, inProgress: t.inProgress + t.suspended, disconnected: t.disconnected ?? 0, submitted: t.submitted + t.autoSubmitted, flagged: page.rows.filter((r) => r.integrityFlags > 0).length },
      rows: page.rows.map((r) => ({ ...r, total, secondsSinceHeartbeat: r.lastSeenAt ? Math.round((Date.now() - new Date(r.lastSeenAt).getTime()) / 1000) : null })),
    };
  }

  private async loadAttempt(u: AuthUser, attemptId: string) {
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { student: { select: { institutionId: true, userId: true, regNo: true } } } });
    if (!a) throw notFound('Attempt');
    const inst = await this.monitorScope(u, a.examId).catch(() => { throw notFound('Attempt'); });
    if (inst && !inst.includes(a.student.institutionId)) throw notFound('Attempt');
    return a;
  }

  /** Time extension for verified disruptions. Capped, reasoned, audited and visible to the candidate's client via the next heartbeat. */
  async extend(u: AuthUser, attemptId: string, minutes: number, reason: string, ip?: string) {
    const a = await this.loadAttempt(u, attemptId);
    if (a.status !== 'IN_PROGRESS') throw conflict('ATTEMPT_CLOSED', 'The attempt is no longer in progress');
    const r = await this.prisma.$queryRaw<{ deadlineAt: Date }[]>`
      UPDATE attempts SET "deadlineAt" = "deadlineAt" + make_interval(mins => ${minutes}::int), "extraTimeMin" = "extraTimeMin" + ${minutes}::int
      WHERE id = ${attemptId}::uuid AND status = 'IN_PROGRESS' RETURNING "deadlineAt"`;
    if (!r.length) throw conflict('ATTEMPT_CLOSED', 'The attempt is no longer in progress');
    await this.prisma.attemptEvent.create({ data: { attemptId, kind: 'TIME_EXTENDED', actorId: u.id, detail: { minutes, reason } } });
    await this.audit.log({ actor: u, action: 'attempt.extend_time', entity: 'attempt', entityId: attemptId, institutionId: a.student.institutionId, meta: { minutes, reason }, ip });
    return { deadlineAt: r[0]!.deadlineAt };
  }

  async forceSubmit(u: AuthUser, attemptId: string, reason: string, ip?: string) {
    const a = await this.loadAttempt(u, attemptId);
    const r = await this.delivery.finalize(a.id, { mode: 'FORCED', actor: u, reason, ip });
    await this.notifications.notify([a.student.userId], 'Examination ended by invigilator', reason, LINKS.schedule);
    return r;
  }

  // ───────────── incidents ─────────────
  async report(u: AuthUser, d: { examId: string; institutionId: string; attemptId?: string; studentId?: string; type: string; severity: string; description: string }, ip?: string) {
    scope.assert(u, d.institutionId);
    const exam = await this.prisma.exam.findFirst({ where: { id: d.examId, institutions: { some: { institutionId: d.institutionId } } } });
    if (!exam) throw badRequest('Exam does not run at this institution');
    if (u.role === 'INVIGILATOR' && !(await this.prisma.examInvigilator.count({ where: { examId: d.examId, userId: u.id, institutionId: d.institutionId } }))) throw forbidden('You are not assigned to this exam at this institution');
    if (d.attemptId) {
      const a = await this.prisma.attempt.findFirst({ where: { id: d.attemptId, examId: d.examId, student: { institutionId: d.institutionId } } });
      if (!a) throw badRequest('Attempt does not belong to this exam and institution');
    }
    const inc = await this.prisma.incident.create({ data: { examId: d.examId, institutionId: d.institutionId, attemptId: d.attemptId, studentId: d.studentId, type: d.type as never, severity: d.severity as never, description: d.description, reportedBy: u.id } });
    await this.audit.log({ actor: u, action: 'incident.report', entity: 'incident', entityId: inc.id, institutionId: d.institutionId, meta: { type: d.type, severity: d.severity }, ip });
    if (d.severity === 'HIGH') await this.notifications.notifyRole('CCE', 'High-severity exam incident', `${exam.code}: ${d.description.slice(0, 140)}`, LINKS.incidents);
    return inc;
  }

  async listIncidents(u: AuthUser, q: { examId?: string; status?: string }) {
    const where: Prisma.IncidentWhereInput = { examId: q.examId, status: q.status as never, institutionId: scope.filter(u), ...(u.role === 'INVIGILATOR' ? { reportedBy: u.id } : {}) };
    return this.prisma.incident.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, include: { exam: { select: { code: true, title: true } }, institution: { select: { code: true } }, notes: { orderBy: { createdAt: 'asc' } } } });
  }

  private async loadIncident(u: AuthUser, id: string) {
    const i = await this.prisma.incident.findUnique({ where: { id } });
    if (!i || !scope.allows(u, i.institutionId) || (u.role === 'INVIGILATOR' && i.reportedBy !== u.id)) throw notFound('Incident');
    return i;
  }

  async addNote(u: AuthUser, id: string, body: string) {
    const i = await this.loadIncident(u, id);
    if (['RESOLVED', 'DISMISSED'].includes(i.status)) throw conflict('BAD_STATE', 'Incident is closed');
    return this.prisma.incidentNote.create({ data: { incidentId: id, authorId: u.id, body } });
  }

  async resolve(u: AuthUser, id: string, status: 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED', resolution: string | undefined, ip?: string) {
    const i = await this.prisma.incident.findUnique({ where: { id } });
    if (!i || !scope.allows(u, i.institutionId)) throw notFound('Incident');
    if (status !== 'INVESTIGATING' && !resolution) throw badRequest('A resolution statement is required');
    await this.prisma.incident.update({ where: { id }, data: { status, resolution, resolvedBy: status === 'INVESTIGATING' ? null : u.id, resolvedAt: status === 'INVESTIGATING' ? null : new Date() } });
    await this.audit.log({ actor: u, action: `incident.${status.toLowerCase()}`, entity: 'incident', entityId: id, institutionId: i.institutionId, meta: { resolution }, ip });
    await this.notifications.notify([i.reportedBy], `Incident ${status.toLowerCase()}`, resolution ?? 'Under investigation', LINKS.incidents);
    return { status };
  }
}
