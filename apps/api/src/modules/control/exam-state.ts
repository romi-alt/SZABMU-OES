/**
 * Exam lifecycle state machine (pure: no I/O). The persisted `Exam.status` is the ONLY state field; the brief's names map onto it:
 *   IN_PROGRESS → LIVE · RESULT_REVIEW → RESULT_PENDING · RESULT_PUBLISHED → PUBLISHED
 * ADMISSION_OPEN, SUSPENDED, CLOSING and SCORING are the additive control-centre states.
 *
 * Every command declares: allowed previous states, the permission, what it does to deadlines and candidates, its audit action, and its
 * idempotency/retry behaviour. `docs/audit/live-exam-control/02-state-machine.md` is generated from the same facts.
 */
export type ExamState = 'DRAFT' | 'PAPER_PENDING' | 'APPROVED' | 'SCHEDULED' | 'ADMISSION_OPEN' | 'LIVE' | 'SUSPENDED' | 'CLOSING' | 'CLOSED' | 'SCORING' | 'RESULT_PENDING' | 'PUBLISHED' | 'CANCELLED';
export type Command = 'OPEN_ADMISSION' | 'CLOSE_ADMISSION' | 'START' | 'SUSPEND' | 'RESUME' | 'EXTEND' | 'CLOSE' | 'RECONCILE' | 'INITIATE_SCORING';

export interface TransitionSpec {
  from: readonly ExamState[];
  to: ExamState | 'SAME';
  precondition: string;
  deadlines: string;
  candidates: string;
  audit: string;
  idempotency: string;
  retry: string;
}

/** Every command requires the `exam.control` permission (CCE, Super Admin). Policy changes need `exam.control.policy`; read-only access `exam.control.view`. */
export const COMMAND_PERMISSION = 'exam.control' as const;
export const TRANSITIONS: Record<Command, TransitionSpec> = {
  OPEN_ADMISSION: {
    from: ['SCHEDULED', 'LIVE', 'SUSPENDED'], to: 'ADMISSION_OPEN',
    precondition: 'paper approved, ≥1 question, ≥1 admitted roster candidate, window not over. From LIVE/SUSPENDED it re-opens admission that was closed.',
    deadlines: 'None. No attempt deadline is touched.', candidates: 'Eligible candidates may enter; others stay blocked by the admission gate.',
    audit: 'exam.control.open_admission', idempotency: 'Already open → 200, changed:false, no event.', retry: 'Safe to retry; state-based.',
  },
  CLOSE_ADMISSION: {
    from: ['ADMISSION_OPEN', 'LIVE', 'SUSPENDED'], to: 'SAME',
    precondition: 'admission currently open', deadlines: 'None.', candidates: 'No NEW attempts; attempts already started keep every right (save, submit, resume).',
    audit: 'exam.control.close_admission', idempotency: 'Already closed → changed:false.', retry: 'Safe to retry.',
  },
  START: {
    from: ['SCHEDULED', 'ADMISSION_OPEN'], to: 'LIVE',
    precondition: 'same checks as OPEN_ADMISSION; synchronized exams need start+duration ≤ window end (or extendWindow).',
    deadlines: 'SYNCHRONIZED: official clock starts now (all deadlines derive from it). INDIVIDUAL: none.', candidates: 'SYNCHRONIZED candidates waiting in the lobby may begin; INDIVIDUAL candidates begin when they choose.',
    audit: 'exam.control.start', idempotency: 'Already LIVE → changed:false (official start never moves).', retry: 'Safe to retry.',
  },
  SUSPEND: {
    from: ['LIVE'], to: 'SUSPENDED',
    precondition: 'suspend-time policy approved on the exam; reason ≥ 10 chars; explicit confirm; scope EXAM | CAMPUS | CANDIDATES.',
    deadlines: 'Per approved policy: FREEZE_CLOCK (deadlines shift by the paused time at resume) or CLOCK_CONTINUES (never changed).',
    candidates: 'Affected in-progress attempts get suspendedAt: saves and submits are refused by the database predicate; new starts are refused for the scope.',
    audit: 'exam.control.suspend', idempotency: 'Same scope already suspended → changed:false.', retry: 'Safe to retry.',
  },
  RESUME: {
    from: ['SUSPENDED', 'LIVE'], to: 'LIVE',
    precondition: 'an open suspension exists (exam-wide one by default, or suspensionId for a partial one)',
    deadlines: 'FREEZE_CLOCK: each attempt deadline += its own paused duration, window end += exam-wide pause; CLOCK_CONTINUES: unchanged.',
    candidates: 'Suspended attempts resume with every confirmed answer intact; sealed attempts are never modified; candidates notified.',
    audit: 'exam.control.resume', idempotency: 'Suspension already resumed → changed:false.', retry: 'Safe to retry.',
  },
  EXTEND: {
    from: ['LIVE', 'SUSPENDED', 'CLOSING'], to: 'SAME',
    precondition: 'reason ≥ 10 chars; 1–240 minutes; explicit confirm; idempotencyKey; scope CANDIDATES | CAMPUS | EXAM.',
    deadlines: 'IN_PROGRESS attempts in scope: deadline += minutes (one atomic UPDATE). EXAM scope also moves the window end.', candidates: 'Sealed attempts are never reopened.',
    audit: 'exam.control.extend', idempotency: '(exam, idempotencyKey) is unique: a repeat returns the stored result and applies nothing.', retry: 'Retry with the SAME key.',
  },
  CLOSE: {
    from: ['ADMISSION_OPEN', 'LIVE', 'SUSPENDED', 'CLOSING'], to: 'CLOSING',
    precondition: 'a SUSPENDED exam can only be closed with force (or resumed first)', deadlines: 'None; attempts finish at their own deadlines unless force.',
    candidates: 'Admission closes. force seals every remaining attempt (FORCED, audited). When nothing is in progress the exam becomes CLOSED.',
    audit: 'exam.control.close', idempotency: 'CLOSING/CLOSED → changed:false (force on CLOSING escalates once).', retry: 'Safe to retry; reconciliation finishes an interrupted force-close.',
  },
  RECONCILE: {
    from: ['LIVE', 'SUSPENDED', 'CLOSING', 'CLOSED', 'SCORING'], to: 'SAME',
    precondition: 'none', deadlines: 'Seals attempts whose database-derived deadline has passed (never a suspended/frozen one).', candidates: 'Expired attempts are sealed exactly once.',
    audit: 'exam.control.reconcile', idempotency: 'Naturally idempotent.', retry: 'Safe to retry.',
  },
  INITIATE_SCORING: {
    from: ['CLOSED'], to: 'SCORING',
    precondition: 'no attempt in progress; ≥1 roster candidate', deadlines: 'None.', candidates: 'Sealed attempts are scored once; absentees recorded; then RESULT_PENDING.',
    audit: 'exam.control.initiate_scoring', idempotency: 'Already SCORING → changed:false.', retry: 'Safe to retry.',
  },
};

export interface ExamFacts { status: ExamState; admissionClosedAt: Date | null; suspendTimePolicy: string | null; openSuspensions: number; examSuspended: boolean }

/** Which commands the UI may offer right now, with the reason when not. The server re-checks everything on execution. */
export function availableCommands(f: ExamFacts): { command: Command; allowed: boolean; reason?: string }[] {
  const s = f.status; const admissionOpen = s === 'ADMISSION_OPEN' || ((s === 'LIVE' || s === 'SUSPENDED') && !f.admissionClosedAt);
  const r = (command: Command, allowed: boolean, reason?: string) => ({ command, allowed, ...(allowed ? {} : { reason }) });
  const bad = (c: Command) => `Not available while the examination is ${s}`;
  return [
    r('OPEN_ADMISSION', (s === 'SCHEDULED' || ((s === 'LIVE' || s === 'SUSPENDED') && !!f.admissionClosedAt)), admissionOpen ? 'Admission is already open' : bad('OPEN_ADMISSION')),
    r('CLOSE_ADMISSION', admissionOpen, 'Admission is not open'),
    r('START', s === 'SCHEDULED' || s === 'ADMISSION_OPEN', bad('START')),
    r('SUSPEND', s === 'LIVE' && !!f.suspendTimePolicy, s !== 'LIVE' ? bad('SUSPEND') : 'The suspension time policy has not been approved for this examination'),
    r('RESUME', f.openSuspensions > 0, 'Nothing is suspended'),
    r('EXTEND', s === 'LIVE' || s === 'SUSPENDED' || s === 'CLOSING', bad('EXTEND')),
    r('CLOSE', ['ADMISSION_OPEN', 'LIVE', 'SUSPENDED', 'CLOSING'].includes(s), bad('CLOSE')),
    r('RECONCILE', ['LIVE', 'SUSPENDED', 'CLOSING', 'CLOSED', 'SCORING'].includes(s), bad('RECONCILE')),
    r('INITIATE_SCORING', s === 'CLOSED', bad('INITIATE_SCORING')),
  ];
}

/** States in which a candidate may begin a NEW attempt (existing attempts may always resume). */
export function startableStates(controlMode: 'AUTOMATIC' | 'MANUAL'): readonly ExamState[] {
  return controlMode === 'AUTOMATIC' ? ['SCHEDULED', 'ADMISSION_OPEN', 'LIVE'] : ['ADMISSION_OPEN', 'LIVE'];
}
export const TERMINAL_FOR_ATTEMPTS: readonly ExamState[] = ['CLOSED', 'SCORING', 'RESULT_PENDING', 'PUBLISHED', 'CANCELLED'];
