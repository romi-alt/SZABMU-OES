import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { CONFIG, type Config } from '../config';
import { PrismaService } from './prisma.service';
import { QUEUES, QueuesService } from './queues.service';

/**
 * Transport options. Authenticated SMTP (SMTP_USER/SMTP_PASS) always requires TLS with a verified certificate, so credentials
 * never cross the wire in clear text — whatever NODE_ENV says. An unauthenticated relay keeps the old dev behaviour (Mailpit).
 */
export function smtpTransportOptions(cfg: Pick<Config, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'SMTP_SECURE' | 'NODE_ENV'>) {
  const secure = cfg.SMTP_SECURE ? cfg.SMTP_SECURE === 'true' : cfg.SMTP_PORT === 465;
  const auth = cfg.SMTP_USER && cfg.SMTP_PASS ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined;
  const strict = cfg.NODE_ENV === 'production' || !!auth;
  return { host: cfg.SMTP_HOST, port: cfg.SMTP_PORT, secure, auth, requireTLS: !secure && strict, tls: { rejectUnauthorized: strict } };
}

/** Outbox pattern: every message is persisted first, then delivered by a BullMQ worker. */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueuesService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async enqueue(toEmail: string, subject: string, body: string, kind: string) {
    const m = await this.prisma.outboundMessage.create({ data: { toEmail, subject, body, kind } });
    await this.queues.add(QUEUES.mail, 'send', { id: m.id }, { jobId: `mail-${m.id}` }).catch((e) => this.log.warn(`enqueue failed: ${e.message}`));
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
      const t = nodemailer.createTransport(smtpTransportOptions(this.cfg));
      await t.sendMail({ from: this.cfg.MAIL_FROM, to: m.toEmail, subject: m.subject, text: m.body });
      await this.prisma.outboundMessage.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } } });
    } catch (e) {
      await this.prisma.outboundMessage.update({ where: { id }, data: { status: 'FAILED', lastError: String(e.message).slice(0, 500), attempts: { increment: 1 } } });
      throw e;
    }
  }

  /**
   * Database-driven backstop for the outbox: delivers messages that were persisted but never sent (queue consumer down, Redis down) or
   * that failed. Used by the finite reconcile command (cron). No-op without an SMTP host (outbox-only mode), bounded per call and per message.
   */
  async retryUndelivered(limit = 25): Promise<{ attempted: number; sent: number }> {
    if (!this.cfg.SMTP_HOST) return { attempted: 0, sent: 0 };
    const due = await this.prisma.outboundMessage.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 }, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true } });
    let sent = 0;
    for (const m of due) { try { await this.deliver(m.id); sent++; } catch { /* recorded on the row; retried on the next pass until attempts = 5 */ } }
    return { attempted: due.length, sent };
  }
}
