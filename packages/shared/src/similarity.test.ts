import { describe, expect, it } from 'vitest';
import { jaccard, normalise, similarPairs } from './similarity';

const q = (id: string, stem: string, options = ['Sarcoidosis', 'Tuberculosis', 'Crohn disease', 'Cat-scratch disease'], vignette?: string) => ({ id, stem, options, vignette });

describe('near-duplicate question detection', () => {
  it('normalises case, punctuation, accents and filler words', () => {
    expect(normalise('Caseating Granulomas — are MOST characteristic of: Tuberculosis?')).toEqual(['caseating', 'granulomas', 'characteristic', 'tuberculosis']);
  });

  it('finds a reworded copy with options in a different order, and ignores unrelated questions', () => {
    const pairs = similarPairs([
      q('q1', 'Caseating granulomas are most characteristic of which disease?'),
      q('q2', 'Caseating granulomas are characteristic of which disease', ['Tuberculosis', 'Cat-scratch disease', 'Sarcoidosis', 'Crohn disease']),
      q('q3', 'Reed–Sternberg cells are the diagnostic feature of:', ['Burkitt lymphoma', 'Hodgkin lymphoma', 'Multiple myeloma', 'CLL']),
    ]);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([['q1', 'q2']]);
    expect(pairs[0]!.score).toBeGreaterThan(0.8);
  });

  it('an exact copy scores 1; the same stem with a different clinical vignette scores lower than an exact copy', () => {
    const a = q('a', 'Which electron-microscopy finding is expected on renal biopsy?', ['Effacement of foot processes', 'Subepithelial humps', 'Splitting of GBM', 'Mesangial IgA deposits'], 'An 8-year-old boy develops periorbital oedema two weeks after a sore throat.');
    const b = { ...a, id: 'b' };
    const c = { ...a, id: 'c', vignette: 'A 45-year-old woman with long-standing diabetes presents with nephrotic-range proteinuria and hypertension.' };
    const p = similarPairs([a, b, c], 0);
    expect(p.find((x) => x.a === 'a' && x.b === 'b')!.score).toBe(1);
    expect(p.find((x) => x.a === 'a' && x.b === 'c')!.score).toBeLessThan(1);
  });

  it('respects the threshold and is deterministic', () => {
    const items = [q('x', 'Most common site of colorectal carcinoma?', ['Rectosigmoid', 'Caecum', 'Transverse colon', 'Ascending colon']), q('y', 'Most common site of gastric carcinoma?', ['Antrum', 'Fundus', 'Body', 'Cardia'])];
    expect(similarPairs(items, 0.9)).toEqual([]);
    expect(similarPairs(items, 0.0)).toEqual(similarPairs(items, 0.0));
    expect(jaccard(new Set(), new Set())).toBe(1);
  });
});
