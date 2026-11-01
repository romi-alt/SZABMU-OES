import { describe, expect, it } from 'vitest';
import { describeExam, examPriority, examStateLabel, type ExamStatusInput } from './exam-status';

const NOW = new Date('2026-11-01T08:00:00Z'); const fmt = (d: string | Date) => `<${new Date(d).toISOString().slice(11, 16)}>`;
const base = (o: Partial<ExamStatusInput>): ExamStatusInput => ({ status: 'LIVE', opensAt: '2026-11-01T09:00:00Z', closesAt: '2026-11-01T12:00:00Z', canStart: false, controlMode: 'AUTOMATIC', timingPolicy: 'INDIVIDUAL', ...o });
const d = (o: Partial<ExamStatusInput>) => describeExam(base(o), NOW, fmt);

describe('exam status presentation (UI-007 / UI-008)', () => {
  it('automatic exam that has not opened: states the start time and a "starts" countdown, no action', () => {
    const p = d({ status: 'SCHEDULED' }); expect(p.key).toBe('SCHEDULED_AUTO'); expect(p.detail).toBe('Starts <09:00>.'); expect(p.countdown).toEqual({ to: '2026-11-01T09:00:00.000Z', kind: 'starts' }); expect(p.action).toBeUndefined();
  });
  it('manually controlled exam that has not opened: planned time but NO countdown (nobody knows when the office will open it)', () => {
    const p = d({ status: 'SCHEDULED', controlMode: 'MANUAL' }); expect(p.key).toBe('SCHEDULED_MANUAL'); expect(p.countdown).toBeUndefined(); expect(p.detail).toContain('Planned for <09:00>');
  });
  it('THE AUDIT CASE: a manually started exam that is live while its planned window is still in the future never shows a start countdown', () => {
    const p = d({ status: 'LIVE', controlMode: 'MANUAL', canStart: true, opensAt: '2026-11-01T09:00:00Z' });
    expect(p.key).toBe('OPEN_TO_START'); expect(p.label).toBe('Open — you can start now'); expect(p.countdown?.kind).toBe('closes'); expect(p.action).toEqual({ kind: 'start', label: 'Start' }); expect(p.detail).not.toMatch(/starts|opens/i);
  });
  it('admission open: individual candidates may begin; synchronized candidates enter a waiting room', () => {
    expect(d({ status: 'ADMISSION_OPEN', canStart: true }).detail).toContain('You may begin now'); expect(d({ status: 'ADMISSION_OPEN', canStart: true, timingPolicy: 'SYNCHRONIZED' }).detail).toContain('starts it');
    expect(d({ status: 'ADMISSION_OPEN', canStart: true }).label).toBe('Admission is open');
  });
  it('live but this candidate cannot start: admission closed vs not admitted are different, honest messages', () => {
    expect(d({ status: 'LIVE', admission: 'CLOSED' }).key).toBe('ADMISSION_CLOSED'); expect(d({ status: 'LIVE' }).key).toBe('NOT_AVAILABLE'); expect(d({ status: 'LIVE' }).action).toBeUndefined();
  });
  it('candidate already in progress: resume with the deadline; suspended: paused message, resume only if the server allows it', () => {
    const p = d({ attempt: { status: 'IN_PROGRESS', deadlineAt: '2026-11-01T10:30:00Z' }, canStart: true }); expect(p.key).toBe('IN_PROGRESS'); expect(p.detail).toContain('<10:30>'); expect(p.action?.kind).toBe('resume');
    const s = d({ attempt: { status: 'IN_PROGRESS' }, suspended: true, canStart: true }); expect(s.key).toBe('SUSPENDED'); expect(s.tone).toBe('amber'); expect(s.action?.kind).toBe('resume');
    expect(d({ status: 'SUSPENDED' }).action).toBeUndefined();
  });
  it('after submission: submitted while open, awaiting results while scoring/pending, results published with a link', () => {
    const att = { status: 'SUBMITTED', receiptCode: 'RC-ABC' };
    expect(d({ attempt: att }).key).toBe('SUBMITTED'); expect(d({ attempt: att }).detail).toContain('RC-ABC');
    for (const status of ['CLOSING', 'CLOSED', 'SCORING', 'RESULT_PENDING']) expect(d({ status, attempt: att }).key).toBe('AWAITING_RESULTS');
    expect(d({ status: 'PUBLISHED', attempt: att }).action).toEqual({ kind: 'view-result', label: 'View result' });
    expect(d({ attempt: { status: 'AUTO_SUBMITTED' }, status: 'RESULT_PENDING' }).key).toBe('AWAITING_RESULTS');
  });
  it('never sat: closed / results published (absent) / cancelled', () => {
    expect(d({ status: 'CLOSED' }).key).toBe('CLOSED_NOT_SAT'); expect(d({ status: 'PUBLISHED' }).detail).toContain('did not sit'); expect(d({ status: 'CANCELLED' }).key).toBe('CANCELLED');
  });
  it('invariants over every status × attempt × canStart combination', () => {
    const statuses = ['SCHEDULED', 'ADMISSION_OPEN', 'LIVE', 'SUSPENDED', 'CLOSING', 'CLOSED', 'SCORING', 'RESULT_PENDING', 'PUBLISHED', 'CANCELLED'];
    const attempts = [null, { status: 'IN_PROGRESS' }, { status: 'SUBMITTED', receiptCode: 'RC-1' }, { status: 'AUTO_SUBMITTED' }];
    for (const status of statuses) for (const attempt of attempts) for (const canStart of [true, false]) for (const controlMode of ['AUTOMATIC', 'MANUAL']) for (const opensAt of ['2026-11-01T07:00:00Z', '2026-11-01T09:00:00Z']) {
      const p = d({ status, attempt, canStart, controlMode, opensAt }); const tag = JSON.stringify({ status, attempt, canStart, controlMode, opensAt });
      if (p.countdown?.kind === 'starts') expect(p.key, tag).toBe('SCHEDULED_AUTO');                                     // a "starts in" countdown only before an automatic exam opens
      if (p.action && p.action.kind !== 'view-result') expect(canStart, `${tag} offers an action the server did not allow`).toBe(true);
      expect(/live|in progress/i.test(p.label) && /starts in|opens in/i.test(p.detail), tag).toBe(false);                 // no contradictory "live + starts in"
      expect(p.label.length).toBeGreaterThan(0); expect(p.detail.length).toBeGreaterThan(0);
    }
  });
  it('priority puts what needs the candidate first; shared state labels are stable', () => {
    expect(examPriority(d({ attempt: { status: 'IN_PROGRESS' }, canStart: true }))).toBeLessThan(examPriority(d({ status: 'SCHEDULED' })));
    expect(examStateLabel('RESULT_PENDING')).toBe('Results pending'); expect(examStateLabel('ADMISSION_OPEN')).toBe('Admission open'); expect(examStateLabel('SOMETHING_NEW')).toBe('Something new');
  });
});
