import { describe, it, expect } from 'vitest';
import { computeDeadline, paletteState, scoreQuestion, sumScores, seededOrder, percent } from './exam-rules';
import { answerDigest, receiptCode } from './server';
import { can, PERMISSIONS } from './permissions';
import { checkPassword } from './password';
import { ROLES } from './roles';

describe('deadline', () => {
  const start = new Date('2026-03-05T09:00:00Z');
  it('adds duration and accommodation', () => {
    expect(computeDeadline({ startedAt: start, durationMin: 120, extraTimeMin: 30, windowEndsAt: new Date('2026-03-05T20:00:00Z') }).toISOString()).toBe('2026-03-05T11:30:00.000Z');
  });
  it('never exceeds the exam window', () => {
    expect(computeDeadline({ startedAt: start, durationMin: 120, extraTimeMin: 0, windowEndsAt: new Date('2026-03-05T10:00:00Z') }).toISOString()).toBe('2026-03-05T10:00:00.000Z');
  });
});

describe('palette', () => {
  it('classifies', () => {
    expect(paletteState({ visited: false })).toBe('NOT_VISITED');
    expect(paletteState({ visited: true })).toBe('UNANSWERED');
    expect(paletteState({ visited: true, state: 'SKIPPED' })).toBe('SKIPPED');
    expect(paletteState({ visited: true, state: 'ANSWERED', selectedLabel: 'B' })).toBe('ANSWERED');
    expect(paletteState({ visited: true, state: 'CLEARED', selectedLabel: null })).toBe('UNANSWERED');
  });
});

describe('scoring', () => {
  const o = { negativeMarkingFraction: 0.25 };
  it('awards, zeroes and penalises', () => {
    expect(scoreQuestion({ marks: 2, correctLabel: 'A', selectedLabel: 'A' }, o)).toBe(2);
    expect(scoreQuestion({ marks: 2, correctLabel: 'A', selectedLabel: null }, o)).toBe(0);
    expect(scoreQuestion({ marks: 2, correctLabel: 'A', selectedLabel: 'C' }, o)).toBe(-0.5);
  });
  it('voided question awards full marks', () => {
    expect(scoreQuestion({ marks: 2, correctLabel: 'A', selectedLabel: 'C', voided: true }, o)).toBe(2);
  });
  it('clamps totals', () => {
    expect(sumScores([-1, -1], 10)).toBe(0);
    expect(sumScores([6, 6], 10)).toBe(10);
    expect(percent(38, 50)).toBe(76);
  });
});

describe('digest & receipt', () => {
  const a = [{ examQuestionId: 'b', selectedLabel: 'A', revision: 2 }, { examQuestionId: 'a', selectedLabel: null, revision: 1 }];
  it('is order independent', () => {
    expect(answerDigest(a)).toBe(answerDigest([...a].reverse()));
  });
  it('changes with content', () => {
    expect(answerDigest(a)).not.toBe(answerDigest([{ ...a[0]!, selectedLabel: 'B' }, a[1]!]));
  });
  it('receipt is deterministic and keyed', () => {
    const t = new Date('2026-03-05T10:00:00Z');
    expect(receiptCode('k1', 'x', 'd', t)).toBe(receiptCode('k1', 'x', 'd', t));
    expect(receiptCode('k1', 'x', 'd', t)).not.toBe(receiptCode('k2', 'x', 'd', t));
    expect(receiptCode('k1', 'x', 'd', t)).toMatch(/^RC-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  });
});

describe('seededOrder', () => {
  it('is stable per seed, differs across seeds, keeps members', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(seededOrder(items, 's1')).toEqual(seededOrder(items, 's1'));
    expect(seededOrder(items, 's1')).not.toEqual(seededOrder(items, 's2'));
    expect([...seededOrder(items, 's1')].sort((x, y) => x - y)).toEqual(items);
  });
});

describe('permission matrix', () => {
  it('students can only sit exams and read own results', () => {
    const studentPerms = (Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]).filter((p) => can('STUDENT', p));
    expect(studentPerms.sort()).toEqual(['exam.sit', 'program.read', 'result.read_own']);
  });
  it('only CCE/SUPER_ADMIN publish results', () => {
    expect(ROLES.filter((r) => can(r, 'result.publish')).sort()).toEqual(['CCE', 'SUPER_ADMIN']);
  });
  it('campus admins cannot author questions or publish', () => {
    expect(can('CAMPUS_ADMIN', 'question.write')).toBe(false);
    expect(can('CAMPUS_ADMIN', 'result.publish')).toBe(false);
  });
  it('invigilators cannot grade or approve', () => {
    expect(can('INVIGILATOR', 'grading.review')).toBe(false);
    expect(can('INVIGILATOR', 'paper.approve')).toBe(false);
  });
});

describe('password policy', () => {
  it('rejects weak, accepts strong', () => {
    expect(checkPassword('short1A!').ok).toBe(false);
    expect(checkPassword('alllowercaseletters').ok).toBe(false);
    expect(checkPassword('Tr1cky-Horse-Battery').ok).toBe(true);
    expect(checkPassword('Anila-Qureshi-2024!', ['anila']).ok).toBe(false);
  });
});
