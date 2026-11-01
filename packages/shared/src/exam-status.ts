/**
 * One presentation model for "what is the state of this examination, for THIS candidate, right now?" (audit UI-007 / UI-008).
 * It is derived only from authoritative server facts (exam status, control mode, the candidate's attempt, canStart) — never from the clock alone —
 * so a running examination can never show a future "starts in" countdown, and an examination that has not opened never claims to be live.
 * Used by the student dashboard, schedule and examination entry page; staff screens use `examStateLabel` so the same words appear everywhere.
 */
export interface ExamStatusInput {
  status: string;                                   // exam status as delivered by /me/exams (SCHEDULED, ADMISSION_OPEN, LIVE, SUSPENDED, CLOSING, CLOSED, SCORING, RESULT_PENDING, PUBLISHED, CANCELLED)
  opensAt: string | Date; closesAt: string | Date;
  canStart: boolean;                                // the server's decision: may this candidate begin or resume right now?
  controlMode?: 'AUTOMATIC' | 'MANUAL' | string;
  timingPolicy?: 'INDIVIDUAL' | 'SYNCHRONIZED' | string;
  admission?: 'OPEN' | 'CLOSED';
  suspended?: boolean;
  attempt?: { status: string; receiptCode?: string | null; submittedAt?: string | Date | null; deadlineAt?: string | Date | null } | null;
}
export type ExamPresentationKey =
  | 'SCHEDULED_AUTO' | 'SCHEDULED_MANUAL' | 'ADMISSION_OPEN' | 'OPEN_TO_START' | 'ADMISSION_CLOSED' | 'NOT_AVAILABLE'
  | 'IN_PROGRESS' | 'SUSPENDED' | 'SUBMITTED' | 'AWAITING_RESULTS' | 'RESULTS_PUBLISHED' | 'CLOSED_NOT_SAT' | 'CANCELLED';
export type PresentationTone = 'green' | 'amber' | 'blue' | 'grey' | 'red';
export interface ExamPresentation {
  key: ExamPresentationKey; label: string; tone: PresentationTone; detail: string;
  /** Only ever present when the number is meaningful: "starts" for an automatic exam that has not opened, "closes" while it is open for entry. */
  countdown?: { to: string; kind: 'starts' | 'closes' };
  action?: { kind: 'start' | 'resume' | 'view-result'; label: string };
}
type Fmt = (d: string | Date) => string;
const iso = (d: string | Date) => new Date(d).toISOString();
const SETTLED = ['CLOSING', 'CLOSED', 'SCORING', 'RESULT_PENDING'];

export function describeExam(x: ExamStatusInput, now: Date, fmt: Fmt): ExamPresentation {
  const a = x.attempt ?? null; const finished = !!a && a.status !== 'IN_PROGRESS'; const resumable = !!a && a.status === 'IN_PROGRESS';
  if (x.status === 'CANCELLED') return { key: 'CANCELLED', label: 'Cancelled', tone: 'grey', detail: 'This examination has been cancelled. Contact the examination office for details.' };

  if (finished) {
    const rc = a!.receiptCode ? ` Receipt ${a!.receiptCode}.` : '';
    if (x.status === 'PUBLISHED') return { key: 'RESULTS_PUBLISHED', label: 'Results published', tone: 'green', detail: `You submitted this examination.${rc}`, action: { kind: 'view-result', label: 'View result' } };
    if (SETTLED.includes(x.status)) return { key: 'AWAITING_RESULTS', label: 'Submitted — awaiting results', tone: 'blue', detail: `Your answers are submitted.${rc} Results appear after approval and publication.` };
    return { key: 'SUBMITTED', label: 'Submitted', tone: 'blue', detail: `You have finished.${rc} You cannot change your answers.` };
  }
  if (resumable) {
    if (x.suspended || x.status === 'SUSPENDED') return { key: 'SUSPENDED', label: 'Suspended by the examination office', tone: 'amber', detail: 'Your examination is paused and your saved answers are safe. It continues when the office resumes it.', ...(x.canStart ? { action: { kind: 'resume', label: 'Resume' } } : {}) };
    const until = a!.deadlineAt ? ` Your time ends ${fmt(a!.deadlineAt)}.` : '';
    return { key: 'IN_PROGRESS', label: 'In progress', tone: 'blue', detail: `You have started this examination.${until}`, ...(x.canStart ? { action: { kind: 'resume', label: 'Resume' } } : {}) };
  }
  // no attempt yet
  if (x.status === 'PUBLISHED') return { key: 'RESULTS_PUBLISHED', label: 'Results published', tone: 'grey', detail: 'You did not sit this examination.', action: { kind: 'view-result', label: 'View result' } };
  if (SETTLED.includes(x.status)) return { key: 'CLOSED_NOT_SAT', label: 'Closed', tone: 'grey', detail: 'This examination has closed; you did not sit it.' };
  if (x.status === 'SUSPENDED') return { key: 'SUSPENDED', label: 'Suspended by the examination office', tone: 'amber', detail: 'The examination is paused. You will be able to start when it resumes.' };
  if (x.status === 'SCHEDULED') {
    if (x.controlMode === 'MANUAL') return { key: 'SCHEDULED_MANUAL', label: 'Scheduled', tone: 'grey', detail: `Planned for ${fmt(x.opensAt)}. The examination office opens admission; this page updates when it does.` };
    return { key: 'SCHEDULED_AUTO', label: 'Scheduled', tone: 'grey', detail: `Starts ${fmt(x.opensAt)}.`, ...(now < new Date(x.opensAt) ? { countdown: { to: iso(x.opensAt), kind: 'starts' as const } } : {}) };
  }
  if (x.status === 'ADMISSION_OPEN' || x.status === 'LIVE') {
    const closes = `Open until ${fmt(x.closesAt)}.`; const countdown = { to: iso(x.closesAt), kind: 'closes' as const };
    if (x.canStart) {
      if (x.status === 'ADMISSION_OPEN') return x.timingPolicy === 'SYNCHRONIZED'
        ? { key: 'ADMISSION_OPEN', label: 'Admission is open', tone: 'green', detail: 'Enter now. The paper opens for everyone when the examination office starts it.', countdown, action: { kind: 'start', label: 'Start' } }
        : { key: 'ADMISSION_OPEN', label: 'Admission is open', tone: 'green', detail: `You may begin now. ${closes}`, countdown, action: { kind: 'start', label: 'Start' } };
      return { key: 'OPEN_TO_START', label: 'Open — you can start now', tone: 'green', detail: closes, countdown, action: { kind: 'start', label: 'Start' } };
    }
    if (x.admission === 'CLOSED') return { key: 'ADMISSION_CLOSED', label: 'In progress — admission closed', tone: 'grey', detail: 'Late entry is no longer possible. Speak to your invigilator if you believe this is wrong.' };
    return { key: 'NOT_AVAILABLE', label: x.status === 'LIVE' ? 'In progress — not available to you' : 'Admission is open — not available to you', tone: 'grey', detail: 'You are not admitted to this examination. Contact your campus administrator.' };
  }
  return { key: 'SCHEDULED_MANUAL', label: 'Scheduled', tone: 'grey', detail: `Planned for ${fmt(x.opensAt)}.` };
}

/** Importance for "what should I look at first": in-progress/suspended, then startable now, then waiting, then finished. */
export function examPriority(p: ExamPresentation): number {
  return { IN_PROGRESS: 0, SUSPENDED: 1, OPEN_TO_START: 2, ADMISSION_OPEN: 2, SCHEDULED_AUTO: 3, SCHEDULED_MANUAL: 4, NOT_AVAILABLE: 5, ADMISSION_CLOSED: 5, SUBMITTED: 6, AWAITING_RESULTS: 7, RESULTS_PUBLISHED: 8, CLOSED_NOT_SAT: 9, CANCELLED: 9 }[p.key];
}

/** The same words for the same exam state on every staff screen (control centre, lists, dashboards). */
export const EXAM_STATE_LABEL: Record<string, string> = {
  DRAFT: 'Draft', PAPER_PENDING: 'Paper awaiting approval', APPROVED: 'Approved', SCHEDULED: 'Scheduled', ADMISSION_OPEN: 'Admission open', LIVE: 'Live', SUSPENDED: 'Suspended',
  CLOSING: 'Closing', CLOSED: 'Closed', SCORING: 'Scoring', RESULT_PENDING: 'Results pending', PUBLISHED: 'Results published', CANCELLED: 'Cancelled',
};
export const examStateLabel = (status: string) => EXAM_STATE_LABEL[status] ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
