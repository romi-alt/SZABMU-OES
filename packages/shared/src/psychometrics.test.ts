import { describe, expect, it } from 'vitest';
import { itemStatistics, MIN_CANDIDATES } from './psychometrics';

describe('item statistics (classical test theory)', () => {
  // 5 candidates × 3 items, hand-checked:
  // totals = [3, 2, 2, 1, 0]; item p = [0.8, 0.4, 0.4]; Σpq = .16 + .24 + .24 = .64; var(total) = mean(x²) − mean² = (9+4+4+1+0)/5 − 1.6² = 3.6 − 2.56 = 1.04
  // KR-20 = 3/2 × (1 − .64/1.04) = 0.577 (rounded)
  const m: (0 | 1)[][] = [[1, 1, 1], [1, 1, 0], [1, 0, 1], [1, 0, 0], [0, 0, 0]];
  const s = itemStatistics(m);

  it('difficulty, mean, SD and KR-20 match the hand calculation', () => {
    expect(s.items_.map((x) => x.p)).toEqual([0.8, 0.4, 0.4]);
    expect(s.mean).toBe(1.6); expect(s.sd).toBe(1.02);
    expect(s.kr20).toBe(0.577);
  });

  it('discrimination uses the upper and lower 27 % (here 1 candidate each)', () => {
    // upper = candidate 0 (total 3), lower = candidate 4 (total 0)
    expect(s.items_.map((x) => x.d)).toEqual([1, 1, 1]);
  });

  it('point-biserial correlates each item with the rest of the paper (corrected), not with a total that contains it', () => {
    // item 0: col = [1,1,1,1,0], rest = [2,1,1,0,0] → Σxy = 0.8, Σxx = 0.8, Σyy = 2.8 → r = 0.8/√2.24 = 0.535
    expect(s.items_[0]!.rpb).toBeCloseTo(0.535, 3);
  });

  it('is undefined rather than invented when there is no variance', () => {
    const flat = itemStatistics([[1, 1], [1, 1], [1, 1]]);
    expect(flat.kr20).toBeNull(); expect(flat.items_.every((x) => x.rpb === null)).toBe(true);
    expect(itemStatistics([]).items).toBe(0);
    const none = itemStatistics([], 12); expect(none.items).toBe(12); expect(none.candidates).toBe(0); expect(none.kr20).toBeNull(); expect(none.items_).toEqual([]);   // a paper nobody has sat yet: no invented per-item numbers
  });

  it('marks small samples as not reliable and raises no flags for them', () => {
    expect(s.reliable).toBe(false); expect(s.items_.every((x) => x.flags.length === 0)).toBe(true);
  });

  it('flags a miskeyed-looking item (strong candidates get it wrong) once the sample is large enough', () => {
    const rows: (0 | 1)[][] = Array.from({ length: MIN_CANDIDATES + 10 }, (_, i) => {
      const able = i < 20;                                              // 20 strong, 20 weak candidates
      return [able ? 1 : 0, able ? 1 : 0, able ? 1 : 0, able ? 0 : 1];   // item 3 is answered correctly only by the weak group
    });
    const t = itemStatistics(rows);
    expect(t.reliable).toBe(true);
    expect(t.items_[3]!.flags).toContain('NEGATIVE_DISCRIMINATION'); expect(t.items_[3]!.d).toBe(-1);
    expect(t.items_[0]!.flags).toEqual([]);
  });

  it('is deterministic for ties and rejects ragged input', () => {
    expect(itemStatistics(m)).toEqual(itemStatistics(m));
    expect(() => itemStatistics([[1, 0], [1]] as (0 | 1)[][])).toThrow();
  });
});
