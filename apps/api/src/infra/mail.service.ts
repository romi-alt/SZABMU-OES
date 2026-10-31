import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { CONFIG, type Config } from '../config';
import { PrismaService } from './prisma.service';
import { QUEUES, QueuesService } from './queues.service';

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
      const t = nodemailer.createTransport({ host: this.cfg.SMTP_HOST, port: this.cfg.SMTP_PORT, secure: false, requireTLS: this.cfg.NODE_ENV === 'production', tls: { rejectUnauthorized: this.cfg.NODE_ENV === 'production' } });
      await t.sendMail({ from: this.cfg.MAIL_FROM, to: m.toEmail, subject: m.subject, text: m.body });
      await this.prisma.outboundMessage.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } } });
    } catch (e) {
      await this.prisma.outboundMessage.update({ where: { id }, data: { status: 'FAILED', lastError: String(e.message).slice(0, 500), attempts: { increment: 1 } } });
      throw e;
    }
  }
}
