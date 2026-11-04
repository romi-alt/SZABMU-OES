import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Role } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';
import { retryOnDeadlock } from '../../infra/sql';
import type { AuthUser } from '../../common/auth';
import type { Prisma } from '../../generated/prisma/client';

export interface AuditEntry {
  actor?: Pick<AuthUser, 'id' | 'role'> | null;
  action: string;
  entity: string;
  entityId?: string | null;
  institutionId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

const GENESIS = '0'.repeat(64);

/** Key-order-independent JSON: a JSON column does not guarantee key order on read-back, so the hash must not depend on it. */
export function canonical(v: unknown): string {
  if (v === undefined) return 'null';
  const norm = (x: unknown): unknown => {
    if (x instanceof Date) return x.toISOString();
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, val]) => val !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, val]) => [k, norm(val)]));
    return x;
  };
  return JSON.stringify(norm(v));
}

/** Hash-chained audit trail. Rows are serialised with a row lock (app_locks 'audit_chain') so the chain is linear. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(e: AuditEntry): Promise<void> {
    await retryOnDeadlock(() => this.prisma.$transaction((tx) => this.append(tx, e)));
  }

  /**
   * Appends inside the CALLER's transaction, so an audit record and the state change it describes commit or roll back together
   * (used by exam control commands). Takes the global chain lock last-ish: call it at the end of the caller's transaction.
   */
  async append(tx: Prisma.TransactionClient, e: AuditEntry): Promise<void> {
    await tx.$queryRaw`SELECT name FROM app_locks WHERE name = 'audit_chain' FOR UPDATE`;   // serialises the hash chain until commit
    const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
    const prevHash = last?.hash ?? GENESIS;
    const at = new Date();
    const payload = canonical([prevHash, at.toISOString(), e.actor?.id ?? null, e.action, e.entity, e.entityId ?? null, e.institutionId ?? null, e.meta ?? null]);
    const hash = createHash('sha256').update(payload).digest('hex');
    await tx.auditLog.create({
      data: {
        at, actorId: e.actor?.id ?? null, actorRole: (e.actor?.role as Role | undefined) ?? null, action: e.action, entity: e.entity,
        entityId: e.entityId ?? null, institutionId: e.institutionId ?? null, meta: (e.meta ?? undefined) as never, ip: e.ip ?? null, prevHash, hash,
      },
    });
  }

  /** Recomputes the chain; returns the first broken sequence number or null if intact. */
  async verifyChain(limit = 100000): Promise<{ checked: number; brokenAt: string | null }> {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { seq: 'asc' }, take: limit });
    let prev = GENESIS;
    for (const r of rows) {
      const payload = canonical([prev, r.at.toISOString(), r.actorId, r.action, r.entity, r.entityId, r.institutionId, r.meta ?? null]);
      const h = createHash('sha256').update(payload).digest('hex');
      if (r.prevHash !== prev || r.hash !== h) return { checked: rows.length, brokenAt: r.seq.toString() };
      prev = r.hash;
    }
    return { checked: rows.length, brokenAt: null };
  }
}
