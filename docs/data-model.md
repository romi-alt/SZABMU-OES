# Data model

PostgreSQL 16, managed with Prisma migrations in `apps/api/prisma/migrations` (3 migrations: `init`, `integrity_constraints`, `exam_term_review`).
Source of truth: `apps/api/prisma/schema.prisma`. UUID primary keys, `timestamptz` everywhere.

## Entity groups
| Group | Tables |
| --- | --- |
| Organisation | `institutions` (type, constituent/affiliated), `departments`, `programs`, `courses` (university-level subjects by semester) |
| Identity | `users` (single role), `user_institutions` (campus scope), `sessions` (hashed opaque tokens), `password_resets`, `password_history` |
| Students | `students` (reg. no., programme, semester), `enrollments` (course × term, attendance %, eligibility) |
| Question bank | `questions` (MCQ / clinical MCQ with vignette; draft→submitted→approved/rejected→retired), `question_options` (A–E, one correct) |
| Exams | `exams`, `exam_institutions`, `exam_questions` (**frozen snapshot + answer key at approval**), `exam_candidates` (roster + accommodations), `exam_invigilators` |
| Live delivery | `attempts` (deadline, active client claim, receipt, digest), `attempt_answers` (current answer + revision), `answer_events` (append-only journal), `attempt_events` |
| Incidents | `incidents`, `incident_notes` |
| Grading & results | `key_actions` (void/change key), `result_batches` (workflow state), `results`, `certificates` |
| Cross-cutting | `notifications`, `outbound_messages` (mail outbox), `audit_logs` (hash chain) |

## Database-enforced guarantees (migration `integrity_constraints`)
| Guarantee | Mechanism |
| --- | --- |
| Audit log and answer journal are append-only | `BEFORE UPDATE OR DELETE` triggers raise `42501` |
| A sealed attempt's answers are immutable, even to direct SQL | `attempt_answers_lock` trigger checks `attempts.status` |
| Answer state consistent: `ANSWERED` ⇔ label present; revision ≥ 0 | `CHECK` constraints |
| Submitted attempts have a receipt; deadline > start | `CHECK` constraints |
| Exam window valid, duration 5–480 min, pass 0–100 %, negative marking 0–1 | `CHECK` constraints |
| Options labelled A–E; **exactly one correct option per question** | `CHECK` + partial unique index |
| Emails stored lower-case | `CHECK (email = lower(email))` |
| One attempt per candidate per exam; one result per candidate per exam | unique indexes |
| Tamper-evident audit | `hash = SHA-256(prevHash ‖ canonical(entry))`, advisory-locked append, `GET /audit/verify` |

## Key indexes
`attempts(status, deadlineAt)` (sweeper) · `attempts(examId, status)` (monitor) · `attempt_answers` PK `(attemptId, examQuestionId)` (hot upsert) ·
`exam_candidates(institutionId, examId)` · `questions(courseId, status)` · `audit_logs(entity, entityId)`, `(institutionId, at)`.

## Known gaps
- No table partitioning yet for `answer_events`/`attempt_events` (needed at production scale).
- No object-storage-backed tables (materials/attachments) — `S3_*` config exists but nothing is stored there yet.
