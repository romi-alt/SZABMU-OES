/**
 * Pure exam-engine rules shared by API and tests. No I/O here.
 */

export type AnswerState = 'ANSWERED' | 'SKIPPED' | 'CLEARED';
export type PaletteState = 'ANSWERED' | 'SKIPPED' | 'NOT_VISITED' | 'UNANSWERED';

export interface ExamTimingInput {
  startedAt: Date;
  durationMin: number;
  extraTimeMin: number;
  windowEndsAt: Date;
}

/** Authoritative deadline = start + duration + accommodations, never beyond the exam window end. */
export function computeDeadline(i: ExamTimingInput): Date {
  const byDuration = i.startedAt.getTime() + (i.durationMin + i.extraTimeMin) * 60_000;
  return new Date(Math.min(byDuration, i.windowEndsAt.getTime()));
}

export interface SyncTimingInput {
  officialStartAt: Date;
  durationMin: number;
  extraTimeMin: number;
  /** Sum of exam-wide extensions (minutes). */
  examExtensionMin: number;
  /** Total seconds the exam clock was frozen by completed exam-wide FREEZE_CLOCK suspensions. */
  pausedSeconds: number;
  windowEndsAt: Date;
}

/** Synchronized exam: every candidate shares the official clock; accommodations/extensions/pauses move it, the window end caps it. */
export function computeSyncDeadline(i: SyncTimingInput): Date {
  const t = i.officialStartAt.getTime() + (i.durationMin + i.extraTimeMin + i.examExtensionMin) * 60_000 + i.pausedSeconds * 1000;
  return new Date(Math.min(t, i.windowEndsAt.getTime()));
}

/** Palette classification shown on the question sidebar. */
export function paletteState(a: { visited: boolean; state?: AnswerState | null; selectedLabel?: string | null }): PaletteState {
  if (a.state === 'ANSWERED' && a.selectedLabel) return 'ANSWERED';
  if (a.state === 'SKIPPED') return 'SKIPPED';
  if (!a.visited) return 'NOT_VISITED';
  return 'UNANSWERED';
}

export interface ScoreInput {
  marks: number;
  correctLabel: string;
  voided?: boolean;
  selectedLabel?: string | null;
}
export interface ScoreOptions {
  negativeMarkingFraction: number; // 0 = none, 0.25 = lose a quarter of marks on a wrong answer
}

/** Score one MCQ. Unanswered = 0; voided questions award full marks to every candidate who sat the exam. */
export function scoreQuestion(q: ScoreInput, o: ScoreOptions): number {
  if (q.voided) return q.marks;
  if (!q.selectedLabel) return 0;
  if (q.selectedLabel === q.correctLabel) return q.marks;
  return -q.marks * o.negativeMarkingFraction;
}

export function sumScores(parts: number[], total: number): number {
  const s = parts.reduce((a, b) => a + b, 0);
  return Math.max(0, Math.min(total, Math.round(s * 100) / 100));
}

export function percent(score: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((score / total) * 10000) / 100;
}

/** Deterministic per-candidate shuffle (seeded) so reloads never reorder questions. */
export function seededOrder<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
