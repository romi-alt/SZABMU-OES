export const EXAM_STATUSES = ['DRAFT', 'PAPER_PENDING', 'APPROVED', 'SCHEDULED', 'LIVE', 'CLOSED', 'RESULT_PENDING', 'PUBLISHED', 'CANCELLED'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const QUESTION_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETIRED'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const RESULT_BATCH_STATUSES = ['GRADED', 'LECTURER_REVIEWED', 'EXAMINER_APPROVED', 'PUBLISHED'] as const;
export type ResultBatchStatus = (typeof RESULT_BATCH_STATUSES)[number];

export const INSTITUTION_TYPES = ['MEDICAL_COLLEGE', 'DENTAL_COLLEGE', 'NURSING_COLLEGE', 'ALLIED_HEALTH', 'TEACHING_HOSPITAL', 'AFFILIATED_INSTITUTE', 'NURSING_SCHOOL', 'HOSPITAL', 'REHABILITATION_INSTITUTE', 'HEALTH_SCIENCES_INSTITUTE', 'MEDICAL_DENTAL_COLLEGE', 'COLLEGE', 'INSTITUTE'] as const;
export const INCIDENT_TYPES = ['CONNECTIVITY', 'TECHNICAL', 'IDENTITY', 'MISCONDUCT', 'ENVIRONMENT', 'OTHER'] as const;
export const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
export const QUESTION_TYPES = ['MCQ', 'CLINICAL_MCQ'] as const;

/** Server-side grace after the deadline during which an in-flight save is still accepted (policy P-05). */
export const SAVE_GRACE_SECONDS = 5;
/** Client heartbeat cadence; the server marks a candidate "disconnected" after HEARTBEAT_STALE_SECONDS. */
export const HEARTBEAT_SECONDS = 15;
export const HEARTBEAT_STALE_SECONDS = 45;
