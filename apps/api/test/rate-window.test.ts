import { describe, expect, it } from 'vitest';
import { LocalRateWindow } from '../src/common/rate-window';

describe('LocalRateWindow (in-process abuse guard)', () => {
  it('counts within a window, isolates keys, and starts a fresh window after it ends', () => {
    const w = new LocalRateWindow(10_000); const t = 1_000_000;
    for (let i = 1; i <= 100; i++) expect(w.hit('a', t + i)).toBe(i);
    expect(w.hit('a', t + 200)).toBe(101);                 // over a limit of 100 → the caller rejects
    expect(w.hit('b', t + 200)).toBe(1);                   // other keys unaffected
    expect(w.hit('a', t + 10_001)).toBe(1);                // window over: counting restarts
  });
  it('stays bounded: expired keys are swept and memory does not grow without limit', () => {
    const w = new LocalRateWindow(1000, 100); let t = 0;
    for (let round = 0; round < 50; round++) { t += 2000; for (let i = 0; i < 100; i++) w.hit(`k${round}-${i}`, t); }
    expect(w.size).toBeLessThanOrEqual(200);
  });
});
