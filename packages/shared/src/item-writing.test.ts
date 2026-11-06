import { describe, expect, it } from 'vitest';
import { itemWritingChecks, type ItemDraft } from './item-writing';

const good: ItemDraft = {
  stem: 'Caseating granulomas are most characteristic of which disease?',
  options: [{ label: 'A', text: 'Sarcoidosis' }, { label: 'B', text: 'Tuberculosis', isCorrect: true }, { label: 'C', text: 'Crohn disease' }, { label: 'D', text: 'Cat-scratch disease' }],
};
const ids = (q: ItemDraft) => itemWritingChecks(q).map((f) => f.id);

describe('item-writing checks', () => {
  it('a well-written item raises nothing', () => { expect(itemWritingChecks(good)).toEqual([]); });

  it('flags "all/none of the above"', () => {
    expect(ids({ ...good, options: [...good.options.slice(0, 3), { label: 'D', text: 'All of the above' }] })).toContain('ALL_NONE_OF_ABOVE');
  });

  it('flags negative stems in capitals or in the final question', () => {
    expect(ids({ ...good, stem: 'Which of the following is NOT a cause of granulomas?' })).toContain('NEGATIVE_STEM');
    expect(ids({ ...good, stem: 'A man has fever. All are true except which?' })).toContain('NEGATIVE_STEM');
    expect(ids({ ...good, stem: 'A patient who was not vaccinated presents with cough. Which organism is most likely?' })).not.toContain('NEGATIVE_STEM');
  });

  it('flags a key that is clearly the longest option, not a modest difference', () => {
    const long = { ...good, options: good.options.map((o) => (o.isCorrect ? { ...o, text: 'Tuberculosis, a chronic granulomatous infection caused by Mycobacterium tuberculosis' } : o)) };
    expect(ids(long)).toContain('LONGEST_IS_KEY');
    expect(ids({ ...good, options: good.options.map((o) => (o.isCorrect ? { ...o, text: 'Tuberculosis (TB)' } : o)) })).not.toContain('LONGEST_IS_KEY');
  });

  it('flags duplicate options, absolute terms only in distractors, an unclear lead-in and an article cue', () => {
    expect(itemWritingChecks({ ...good, options: [...good.options.slice(0, 3), { label: 'D', text: 'sarcoidosis.' }] }).find((f) => f.id === 'DUPLICATE_OPTIONS')?.options).toEqual(['A', 'D']);
    expect(ids({ ...good, options: [{ label: 'A', text: 'It always resolves' }, { label: 'B', text: 'It usually progresses slowly', isCorrect: true }, { label: 'C', text: 'It never recurs' }, { label: 'D', text: 'Steroids are rarely needed' }] })).toContain('ABSOLUTE_TERMS_IN_DISTRACTORS');
    expect(ids({ ...good, stem: 'Caseating granulomas and tuberculosis' })).toContain('UNCLEAR_LEAD_IN');
    expect(ids({ ...good, stem: 'The most likely diagnosis is an:' })).toContain('ARTICLE_CUE');
  });
});
