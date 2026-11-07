import type { Prisma } from '../../generated/prisma/client';

export type BankState = 'EMPTY' | 'DRAFT' | 'SUBMITTED' | 'REJECTED' | 'APPROVED';

/**
 * The state a question bank is in, from its questions: anything under review → SUBMITTED, else anything returned → REJECTED, else any draft → DRAFT,
 * else all APPROVED. (A bank with no questions is EMPTY and stored as DRAFT.) The stored `question_pools.status` is always set from this by
 * `refreshBankStatus`, which every path that changes a question calls, so the two cannot drift apart.
 */
export function bankState(statuses: string[]): BankState {
  if (!statuses.length) return 'EMPTY'; if (statuses.includes('SUBMITTED')) return 'SUBMITTED'; if (statuses.includes('REJECTED')) return 'REJECTED'; if (statuses.includes('DRAFT')) return 'DRAFT'; return 'APPROVED';
}

/** Recomputes and stores the bank's status. When a review has just settled it (nothing left under review), the reviewer and time are recorded on the bank. */
export async function refreshBankStatus(db: Prisma.TransactionClient, poolId: string, review?: { by: string; note?: string | null }) {
  const qs = await db.question.findMany({ where: { poolId, status: { not: 'RETIRED' } }, select: { status: true } });
  const state = bankState(qs.map((q) => q.status)); const status = state === 'EMPTY' ? 'DRAFT' : state;
  await db.questionPool.update({ where: { id: poolId }, data: { status, ...(review && status !== 'SUBMITTED' ? { reviewedById: review.by, reviewedAt: new Date(), ...(review.note !== undefined ? { reviewNote: review.note } : {}) } : {}) } });
  return status;
}
