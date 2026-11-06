/**
 * Near-duplicate detection for question banks (deterministic; no AI, nothing leaves the system).
 *
 * Each question is reduced to word 3-gram "shingles" of its normalised text (vignette + stem + options, options sorted so A/B order does not
 * matter). Two questions are compared with the Jaccard index of their shingle sets. Candidate pairs are found through an inverted index, so
 * questions that share no shingle are never compared (the bank can be large).
 *
 * The result is a prompt for an author or reviewer ("these look alike"), never an automatic merge or deletion.
 */
export interface SimilarityInput { id: string; vignette?: string | null; stem: string; options?: string[] }
export interface SimilarPair { a: string; b: string; score: number }

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'to', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'with', 'for', 'by', 'at', 'as', 'which', 'what', 'most', 'likely', 'following', 'this', 'that']);

export function normalise(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
}

export function shingles(q: SimilarityInput, n = 3): Set<string> {
  const words = [...normalise(`${q.vignette ?? ''} ${q.stem}`), '|', ...[...(q.options ?? [])].map((o) => normalise(o).join(' ')).sort().join(' | ').split(' ')];
  const out = new Set<string>();
  if (words.length < n) { if (words.length) out.add(words.join(' ')); return out; }
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0; const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** All pairs with similarity ≥ threshold, most similar first. */
export function similarPairs(items: SimilarityInput[], threshold = 0.6): SimilarPair[] {
  const sh = items.map((q) => shingles(q));
  const index = new Map<string, number[]>();
  sh.forEach((s, i) => { for (const g of s) { const l = index.get(g); if (l) l.push(i); else index.set(g, [i]); } });
  const seen = new Set<string>(); const out: SimilarPair[] = [];
  sh.forEach((s, i) => {
    const cands = new Set<number>();
    for (const g of s) for (const j of index.get(g) ?? []) if (j > i) cands.add(j);
    for (const j of cands) {
      const key = `${i}:${j}`; if (seen.has(key)) continue; seen.add(key);
      const score = jaccard(s, sh[j]!);
      if (score >= threshold) out.push({ a: items[i]!.id, b: items[j]!.id, score: Math.round(score * 1000) / 1000 });
    }
  });
  return out.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a));
}
