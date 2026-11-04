import { describe, expect, it } from 'vitest';
import { LocalQueues } from '../src/infra/queues.service';

/** The job runner used when there is no Redis (REDIS_URL unset): BullMQ's retry policy, in process. */
describe('in-process job runner (no Redis)', () => {
  it('runs, retries with back-off, and de-duplicates by job id', async () => {
    const q = new LocalQueues(); let calls = 0; const seen: string[] = [];
    q.register('mail', async (job) => { calls++; seen.push(job.data.id as string); if (calls < 3) throw new Error('smtp down'); }, 4);
    expect(q.add('mail', { id: 'mail-1', name: 'send', data: { id: 'm1' } })).toBe(true);
    expect(q.add('mail', { id: 'mail-1', name: 'send', data: { id: 'm1' } })).toBe(true);              // duplicate while queued: same job
    await q.idle(15_000);
    expect(calls).toBe(3); expect(new Set(seen)).toEqual(new Set(['m1']));                              // failed twice (1 s + 2 s back-off), then ok
    q.close();
  });

  it('respects concurrency and drops jobs without a consumer', async () => {
    const q = new LocalQueues(); let running = 0; let peak = 0;
    q.register('grade', async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 30)); running--; }, 2);
    for (let i = 0; i < 8; i++) q.add('grade', { id: `g${i}`, name: 'grade', data: {} });
    await q.idle();
    expect(peak).toBe(2);
    expect(q.add('nobody', { name: 'x', data: {} })).toBe(false);
    q.close();
  });
});
