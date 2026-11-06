/**
 * Classical test theory item statistics for single-best-answer papers (deterministic; no AI).
 *
 * Input: one row per candidate who sat the paper, one 0/1 per scored item (1 = correct, 0 = wrong or unanswered); voided items are left out
 * by the caller. All statistics are computed on the 0/1 matrix, independent of marks and negative marking, which is the usual convention.
 *
 * - difficulty p           proportion correct (0–1; higher = easier)
 * - discrimination D       p(upper 27 %) − p(lower 27 %) by total score (−1…1)
 * - point-biserial r_pb    corrected item–rest correlation: the item against the total WITHOUT that item (−1…1); null when undefined
 * - KR-20                  internal-consistency reliability of the whole paper; null when undefined (fewer than 2 items or no variance)
 *
 * The numbers describe this sitting only. With few candidates they are unstable: `reliable` is false below MIN_CANDIDATES and the caller must
 * say so. Flags are prompts for academic review, never automatic decisions.
 */
export const MIN_CANDIDATES = 30;
export const GROUP_FRACTION = 0.27;

export interface ItemStats { index: number; n: number; p: number; d: number | null; rpb: number | null; flags: ItemFlag[] }
export type ItemFlag = 'VERY_HARD' | 'VERY_EASY' | 'LOW_DISCRIMINATION' | 'NEGATIVE_DISCRIMINATION';
export interface TestStats { candidates: number; items: number; mean: number; sd: number; kr20: number | null; sem: number | null; reliable: boolean; items_: ItemStats[] }

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
/** Population variance (divide by n), the convention used by KR-20. */
const variance = (a: number[]) => { const m = mean(a); return a.length ? a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length : 0; };

function pearson(x: number[], y: number[]): number | null {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const a = x[i]! - mx, b = y[i]! - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/** `itemCount` is the number of scored items on the paper (needed when nobody has sat it yet; otherwise taken from the rows). */
export function itemStatistics(matrix: (0 | 1)[][], itemCount?: number): TestStats {
  const n = matrix.length; const k = itemCount ?? (n ? matrix[0]!.length : 0);
  if (matrix.some((r) => r.length !== k)) throw new Error('every candidate row must have the same number of items');
  const totals = matrix.map((r) => r.reduce<number>((s, x) => s + x, 0));
  // upper/lower groups by total score; ties broken by original order so the result is deterministic
  const order = totals.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i);
  const g = n >= 2 ? Math.max(1, Math.round(n * GROUP_FRACTION)) : 0;
  const upper = order.slice(0, g), lower = order.slice(n - g);
  const items_: ItemStats[] = [];
  let sumPQ = 0;
  for (let j = 0; n > 0 && j < k; j++) {   // no candidates → no per-item numbers (p = 0 would read as "nobody got it right")
    const col = matrix.map((r) => r[j]!);
    const p = mean(col); sumPQ += p * (1 - p);
    const d = g ? mean(upper.map((i) => col[i]!)) - mean(lower.map((i) => col[i]!)) : null;
    const rest = totals.map((t, i) => t - col[i]!);
    const r = n >= 3 ? pearson(col, rest) : null;
    const flags: ItemFlag[] = [];
    if (n >= MIN_CANDIDATES) {
      if (p < 0.2) flags.push('VERY_HARD'); if (p > 0.95) flags.push('VERY_EASY');
      if (r !== null && r < 0) flags.push('NEGATIVE_DISCRIMINATION'); else if (r !== null && r < 0.1) flags.push('LOW_DISCRIMINATION');
    }
    items_.push({ index: j, n, p: round(p), d: d === null ? null : round(d), rpb: r === null ? null : round(r), flags });
  }
  const vt = variance(totals);
  const kr20 = k >= 2 && vt > 0 ? (k / (k - 1)) * (1 - sumPQ / vt) : null;
  const sd = Math.sqrt(vt);
  return { candidates: n, items: k, mean: round(mean(totals)), sd: round(sd), kr20: kr20 === null ? null : round(kr20), sem: kr20 === null ? null : round(sd * Math.sqrt(Math.max(0, 1 - kr20))), reliable: n >= MIN_CANDIDATES, items_ };
}
