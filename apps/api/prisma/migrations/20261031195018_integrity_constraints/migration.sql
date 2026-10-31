-- Integrity guarantees enforced by the database itself, independent of application code.

-- Audit log and answer journal are append-only.
CREATE OR REPLACE FUNCTION oes_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION oes_forbid_mutation();
CREATE TRIGGER answer_events_append_only BEFORE UPDATE OR DELETE ON answer_events
  FOR EACH ROW EXECUTE FUNCTION oes_forbid_mutation();

-- A submitted attempt's answers can never change again (defence in depth behind the API).
CREATE OR REPLACE FUNCTION oes_lock_submitted_answers() RETURNS trigger AS $$
DECLARE st "AttemptStatus";
BEGIN
  SELECT status INTO st FROM attempts WHERE id = COALESCE(NEW."attemptId", OLD."attemptId");
  IF st IS NOT NULL AND st <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'attempt % is finalised; answers are immutable', COALESCE(NEW."attemptId", OLD."attemptId") USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attempt_answers_lock BEFORE INSERT OR UPDATE OR DELETE ON attempt_answers
  FOR EACH ROW EXECUTE FUNCTION oes_lock_submitted_answers();

ALTER TABLE attempt_answers ADD CONSTRAINT attempt_answers_revision_nonneg CHECK (revision >= 0);
ALTER TABLE attempt_answers ADD CONSTRAINT attempt_answers_state_consistent CHECK (
  (state = 'ANSWERED' AND "selectedLabel" IS NOT NULL) OR (state <> 'ANSWERED' AND "selectedLabel" IS NULL)
);
ALTER TABLE attempts ADD CONSTRAINT attempts_deadline_after_start CHECK ("deadlineAt" > "startedAt");
ALTER TABLE attempts ADD CONSTRAINT attempts_submitted_has_receipt CHECK (
  status = 'IN_PROGRESS' OR status = 'VOID' OR ("submittedAt" IS NOT NULL AND "receiptCode" IS NOT NULL)
);
ALTER TABLE exams ADD CONSTRAINT exams_window_valid CHECK ("closesAt" > "opensAt");
ALTER TABLE exams ADD CONSTRAINT exams_duration_valid CHECK ("durationMin" BETWEEN 5 AND 480);
ALTER TABLE exams ADD CONSTRAINT exams_pass_valid CHECK ("passPercent" BETWEEN 0 AND 100);
ALTER TABLE exams ADD CONSTRAINT exams_neg_valid CHECK ("negativeMarking" BETWEEN 0 AND 1);
ALTER TABLE exam_questions ADD CONSTRAINT exam_questions_marks_pos CHECK (marks > 0);
ALTER TABLE question_options ADD CONSTRAINT question_options_label CHECK (label ~ '^[A-E]$');
-- At most one correct option per question (single-best-answer format).
CREATE UNIQUE INDEX question_options_one_correct ON question_options ("questionId") WHERE "isCorrect";
-- One certificate verify lookup is case-insensitive on email; emails are stored lower-case.
ALTER TABLE users ADD CONSTRAINT users_email_lower CHECK (email = lower(email));
