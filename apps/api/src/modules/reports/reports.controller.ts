import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Perm, type AuthUser } from '../../common/auth';
import { page, parse, uuid } from '../../common/validate';
import { ReportsService } from './reports.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../infra/prisma.service';
import { scope } from '../../common/auth';
import { forbidden } from '../../common/errors';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly audit: AuditService, private readonly notifications: NotificationsService, private readonly prisma: PrismaService) {}

  @Perm('program.read') @Get('dashboard') dashboard(@CurrentUser() u: AuthUser) { return this.reports.dashboard(u); }
  @Perm('report.read') @Get('reports/exams/:id') exam(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.reports.examReport(u, id); }
  @Perm('report.read') @Get('reports/exams/:id/csv') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="results.csv"')
  csv(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.reports.examCsv(u, id); }
  /** Institution headcounts. Scoped to the caller's assigned institutions; naming an institution outside that set is a 403. */
  @Perm('report.read') @Get('reports/institutions')
  inst(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.reports.institutionSummary(u, parse(z.object({ institutionId: uuid.optional() }), q).institutionId); }

  @Perm('audit.read') @Get('audit')
  async auditList(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    const d = parse(page.extend({ entity: z.string().max(40).optional(), action: z.string().max(60).optional(), institutionId: uuid.optional() }), q);
    if (d.institutionId) scope.assert(u, d.institutionId);
    // Campus administrators see only entries tied to their institutions.
    const where = { entity: d.entity, action: d.action ? { startsWith: d.action } : undefined, institutionId: d.institutionId ?? scope.filter(u) };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip: (d.page - 1) * d.pageSize, take: d.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { total, items: items.map((i) => ({ ...i, seq: i.seq.toString() })) };
  }
  @Perm('audit.read') @Get('audit/verify') verify(@CurrentUser() u: AuthUser) {
    if (u.institutionIds !== null) throw forbidden('Chain verification is a university-level operation');
    return this.audit.verifyChain();
  }

  @Perm('program.read') @Get('notifications') async notifs(@CurrentUser() u: AuthUser) { return { unread: await this.notifications.unreadCount(u.id), items: await this.notifications.list(u.id) }; }
  @Perm('program.read') @Post('notifications/:id/read') @HttpCode(200) async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { await this.notifications.markRead(u.id, id); return { ok: true }; }
  @Perm('program.read') @Post('notifications/read-all') @HttpCode(200) async readAll(@CurrentUser() u: AuthUser) { await this.notifications.markAllRead(u.id); return { ok: true }; }

  @Perm('notification.send') @Post('notifications/broadcast') @HttpCode(200)
  async broadcast(@CurrentUser() u: AuthUser, @Body() b: unknown) {
    const d = parse(z.object({ institutionId: uuid.optional(), role: z.enum(['STUDENT', 'LECTURER', 'INVIGILATOR', 'CAMPUS_ADMIN']).optional(), title: z.string().min(3).max(120), body: z.string().min(3).max(1000) }), b);
    if (u.institutionIds !== null && !d.institutionId) throw forbidden('Specify one of your institutions');
    if (d.institutionId) scope.assert(u, d.institutionId);
    const users = await this.prisma.user.findMany({ where: { active: true, role: d.role, institutions: d.institutionId ? { some: { institutionId: d.institutionId } } : undefined }, select: { id: true }, take: 50000 });
    await this.audit.log({ actor: u, action: 'notification.broadcast', entity: 'notification', institutionId: d.institutionId, meta: { recipients: users.length, title: d.title } });
    return { sent: await this.notifications.notify(users.map((x) => x.id), d.title, d.body) };
  }
}
