/**
 * SERVER-ONLY helpers (use Node's crypto). Deliberately NOT exported from the package barrel (`index.ts`): the web app imports the barrel,
 * and a `node:crypto` import there makes the bundler ship a ~450 KB crypto polyfill to every browser (and triggers a CSP `eval` report).
 * Import from '@oes/shared/server' in the API only.
 */
import { createHash, createHmac } from 'node:crypto';

/** Digest of the final answer sheet; order-independent on input, canonical on output. */
export function answerDigest(answers: { examQuestionId: string; selectedLabel: string | null; revision: number }[]): string {
  const canon = [...answers]
    .sort((a, b) => (a.examQuestionId < b.examQuestionId ? -1 : 1))
    .map((a) => `${a.examQuestionId}:${a.selectedLabel ?? '-'}:${a.revision}`)
    .join('|');
  return createHash('sha256').update(canon).digest('hex');
}

/** Human-readable submission receipt code bound to attempt, digest and time via HMAC. */
export function receiptCode(secret: string, attemptId: string, digest: string, submittedAt: Date): string {
  const mac = createHmac('sha256', secret).update(`${attemptId}.${digest}.${submittedAt.toISOString()}`).digest('hex');
  const body = mac.slice(0, 16).toUpperCase();
  return `RC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}
