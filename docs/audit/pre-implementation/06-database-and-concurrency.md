# 06 — Database and Concurrency

31 models, 3 migrations (`20261031195003_init`, `…195018_integrity_constraints`, `…195356_exam_term_review`). Migrations were not executed in this audit.

## Requested-model coverage
| Requested | Present? | Note |
|---|---|---|
| Users, Sessions | ✔ User, Session (SHA-256 token hash) | |
| Roles / Permissions | Role **enum** + permission matrix in code (`packages/shared`) | no DB roles/permissions tables; fine unless custom roles are required |
| Institutions / Campuses | `Institution` only | **no Campus / Venue / ExamCentre entity**; venue = free text on Exam |
| Departments, Programs, Courses | ✔ (Department has no UI) | |
| Students, Enrollment | ✔ (attendance = single %) | no per-session attendance |
| Lecturer ↔ course assignment | ✘ | **HIGH gap** |
| Question bank / options | ✔ | |
| Question versions | counter only (`version`) | no history table |
| Papers | `Exam` + `ExamQuestion` snapshots | |
| Candidates / invigilators | ✔ ExamCandidate, ExamInvigilator | |
| Attempts / answers / events | ✔ Attempt, AttemptAnswer, AnswerEvent, AttemptEvent | |
| Grading / results | Result, ResultBatch, KeyAction | no subjective-grade model; **no result versions** |
| Incidents | ✔ Incident, IncidentNote | |
| Audit | ✔ hash-chained AuditLog | |
| Materials / settings / attachments | ✘ | |

## Integrity controls present (migration `integrity_constraints`)
append-only triggers (`audit_logs`, `answer_events`); `attempt_answers` write-lock when attempt not IN_PROGRESS; CHECKs (marks > 0, revisions ≥ 0, option labels, window ordering); one-correct-option partial unique index for single-answer MCQs; lowercase-unique emails; unique `(examId, studentId)` for attempts and candidates; `certificate_serial_seq`. 35 `@@index/@@unique` declarations; 13 `onDelete: Cascade` relations.

## Concerns
- **Cascade deletes (13):** review each — cascades into `answer_events`/results from a parent delete would destroy evidence. Need a "no hard-delete in production" policy (soft-delete/ARCHIVED) enforced by triggers or role grants. *Not yet analysed relation-by-relation → NOT_VERIFIED.*
- **Status transitions** are enforced in services, not by DB constraints (e.g., Exam.status, ResultBatch.status). Add transition CHECK/trigger or a transition table for the highest-value ones (Attempt, ResultBatch).
- **Scale:** `answer_events` (BigInt id, index on attempt/question/revision) – partition by month/exam before 10k+ concurrent; `audit_logs` single advisory lock serialises every audited write (acknowledged and kept off the candidate path); `attempt_events` fine.
- **Pooling:** Prisma pg adapter pool sizing + PgBouncer transaction-mode compatibility not tested.
- **Timestamps:** all `Timestamptz`; deadline from `clock_timestamp()` (consistent).
- **Backups/PITR/restore drill:** none.

## Concurrency verdict
Atomic revisioned upsert + lock ordering (`KEY SHARE` vs `FOR UPDATE`) closes the save-after-seal race; 20 targeted tests plus the 100,000-answer load verification found no loss or reordering. Deadlock/serialization behaviour under multi-API-process and failover is NOT VERIFIED.
