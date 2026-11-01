import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { CONFIG, type Config } from '../config';
import { PrismaService } from './prisma.service';

/** Outbox pattern: every message is persisted first, then delivered in the background; the lifecycle tick retries failures. */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async enqueue(toEmail: string, subject: string, body: string, kind: string) {
    const m = await this.prisma.outboundMessage.create({ data: { toEmail, subject, body, kind } });
    setImmediate(() => { void this.deliver(m.id).catch((e: Error) => this.log.warn(`delivery of ${m.id} failed (will retry): ${e.message}`)); });
    return m;
  }

  async deliver(id: string) {
    const m = await this.prisma.outboundMessage.findUnique({ where: { id } });
    if (!m || m.status === 'SENT') return;
    if (!this.cfg.SMTP_HOST) {
      this.log.log(`[outbox only] ${m.kind} → ${m.toEmail}`);
      await this.prisma.outboundMessage.update({ where: { id }, data: { status: 'PENDING', attempts: { increment: 1 } } });
      return;
    }
    try {
      const t = nodemailer.createTransport({ host: this.cfg.SMTP_HOST, port: this.cfg.SMTP_PORT, secure: false, requireTLS: this.cfg.NODE_ENV === 'production', tls: { rejectUnauthorized: this.cfg.NODE_ENV === 'production' } });
      await t.sendMail({ from: this.cfg.MAIL_FROM, to: m.toEmail, subject: m.subject, text: m.body });
      await this.prisma.outboundMessage.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } } });
    } catch (e) {
      await this.prisma.outboundMessage.update({ where: { id }, data: { status: 'FAILED', lastError: String(e.message).slice(0, 500), attempts: { increment: 1 } } });
      throw e;
    }
  }

  /** Called by the lifecycle tick: re-send messages that failed or were never attempted. No-op without an SMTP host (outbox-only mode). */
  async retryUndelivered(limit = 25) {
    if (!this.cfg.SMTP_HOST) return;
    const due = await this.prisma.outboundMessage.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 }, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true } });
    for (const m of due) await this.deliver(m.id).catch(() => undefined);
  }
}
