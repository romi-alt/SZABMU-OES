/**
 * Rule-based item-writing checks for single-best-answer MCQs (deterministic; no AI). They follow widely used item-writing guidance for
 * medical single-best-answer questions (e.g. the NBME item-writing guide): avoid "all/none of the above", avoid negatively phrased stems,
 * avoid cues that let a test-wise candidate find the key without the knowledge (longest option, absolute terms, grammatical mismatch),
 * and write a clear lead-in. Each finding is ADVICE for the author and the reviewer; nothing blocks saving or approval.
 */
export interface ItemDraft { stem: string; vignette?: string | null; options: { label: string; text: string; isCorrect?: boolean }[] }
export type CheckId = 'ALL_NONE_OF_ABOVE' | 'NEGATIVE_STEM' | 'LONGEST_IS_KEY' | 'DUPLICATE_OPTIONS' | 'ABSOLUTE_TERMS_IN_DISTRACTORS' | 'UNCLEAR_LEAD_IN' | 'ARTICLE_CUE';
export interface CheckFinding { id: CheckId; message: string; options?: string[] }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.;:,!?]+$/, '').trim();
const ABSOLUTE = /\b(always|never|all|none|only|must|cannot|invariably|completely)\b/i;

export function itemWritingChecks(q: ItemDraft): CheckFinding[] {
  const out: CheckFinding[] = [];
  const opts = q.options.filter((o) => o.text.trim());
  const key = opts.find((o) => o.isCorrect);
  const lead = q.stem.trim();

  const aon = opts.filter((o) => /\b(all|none|both) of the (above|options|following)\b/i.test(o.text));
  if (aon.length) out.push({ id: 'ALL_NONE_OF_ABOVE', message: '"All/none of the above" lets candidates answer from partial knowledge; use a single best answer instead.', options: aon.map((o) => o.label) });

  if (/\b(NOT|EXCEPT|LEAST)\b/.test(lead) || /\b(not|except|least)\b/i.test(lead.split(/[.?:]/).slice(-2).join(' ')))
    out.push({ id: 'NEGATIVE_STEM', message: 'Negatively phrased lead-in (not / except / least). Ask for the single best positive answer where possible.' });

  if (key && opts.length >= 3) {
    const others = opts.filter((o) => o !== key).map((o) => o.text.trim().length);
    const avg = others.reduce((a, b) => a + b, 0) / others.length;
    if (key.text.trim().length > Math.max(...others) && key.text.trim().length >= 1.5 * avg && key.text.trim().length - avg >= 15)
      out.push({ id: 'LONGEST_IS_KEY', message: 'The correct option is clearly the longest; candidates may pick it for its length. Make the options similar in length and detail.', options: [key.label] });
  }

  const seen = new Map<string, string>(); const dups = new Set<string>();
  for (const o of opts) { const k = norm(o.text); if (seen.has(k)) { dups.add(seen.get(k)!); dups.add(o.label); } else seen.set(k, o.label); }
  if (dups.size) out.push({ id: 'DUPLICATE_OPTIONS', message: 'Two or more options have the same text.', options: [...dups] });

  if (key && !ABSOLUTE.test(key.text)) {
    const abs = opts.filter((o) => o !== key && ABSOLUTE.test(o.text));
    if (abs.length >= 2) out.push({ id: 'ABSOLUTE_TERMS_IN_DISTRACTORS', message: 'Absolute words (always, never, only…) appear only in wrong options, which signals them as wrong.', options: abs.map((o) => o.label) });
  }

  if (!/[?:]\s*$/.test(lead)) out.push({ id: 'UNCLEAR_LEAD_IN', message: 'The lead-in does not end as a question. A clear question (ending with "?") lets candidates answer before reading the options.' });

  const art = /\b(a|an)\s*$/i.exec(lead.replace(/[:?]\s*$/, ''));
  if (art && key) {
    const vowel = /^[aeiou]/i.test(key.text.trim());
    if ((art[1]!.toLowerCase() === 'an') !== vowel) out.push({ id: 'ARTICLE_CUE', message: `The lead-in ends with "${art[1]}", which does not fit the correct option grammatically (or fits only some options).`, options: [key.label] });
  }
  return out;
}
