import type { Prisma } from '../../generated/prisma/client';
import type { AuthUser } from '../../common/auth';
import type { AuditService } from '../audit/audit.service';
import type { ExamEventsService } from './events.service';

export interface FinishSpec {
  examId: string;
  actor: Pick<AuthUser, 'id' | 'role'> | null;           // null = the lifecycle reconciler (system)
  action: string;                                          // audit action, e.g. exam.control.suspend
  meta: Record<string, unknown>;
  ip?: string | null;
  events: { type: string; institutionId?: string | null; studentId?: string | null; payload?: Record<string, unknown> }[];
}

/**
 * The tail of EVERY state change, executed inside the caller's transaction and after the guarded UPDATE(s):
 * bump the exam's version, write the outbox event(s) stamped with that version, append the hash-chained audit record.
 * Either all of it commits with the state change or none of it does.
 */
export async function finishTransition(tx: Prisma.TransactionClient, deps: { events: ExamEventsService; audit: AuditService }, s: FinishSpec): Promise<number> {
  await tx.$executeRaw`UPDATE exams SET "stateVersion" = "stateVersion" + 1 WHERE id = ${s.examId}`;
  const v = (await tx.$queryRaw<{ v: number }[]>`SELECT "stateVersion" AS v FROM exams WHERE id = ${s.examId}`)[0]!.v;
  for (const e of s.events) await deps.events.emit(tx, { examId: s.examId, version: v, type: e.type, institutionId: e.institutionId, studentId: e.studentId, payload: e.payload });
  await deps.audit.append(tx, { actor: s.actor, action: s.action, entity: 'exam', entityId: s.examId, meta: { ...s.meta, version: v }, ip: s.ip ?? null });
  return v;
}
