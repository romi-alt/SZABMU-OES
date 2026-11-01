-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'LECTURER', 'EXAMINER', 'CAMPUS_ADMIN', 'INVIGILATOR', 'CCE', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('MEDICAL_COLLEGE', 'DENTAL_COLLEGE', 'NURSING_COLLEGE', 'ALLIED_HEALTH', 'TEACHING_HOSPITAL', 'AFFILIATED_INSTITUTE');

-- CreateEnum
CREATE TYPE "Affiliation" AS ENUM ('CONSTITUENT', 'AFFILIATED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'CLINICAL_MCQ');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PaperStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PAPER_PENDING', 'APPROVED', 'SCHEDULED', 'LIVE', 'CLOSED', 'RESULT_PENDING', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'VOID');

-- CreateEnum
CREATE TYPE "AnswerState" AS ENUM ('ANSWERED', 'SKIPPED', 'CLEARED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'WITHDRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EligibilityStatus" AS ENUM ('ELIGIBLE', 'INELIGIBLE', 'CONDONED');

-- CreateEnum
CREATE TYPE "ResultBatchStatus" AS ENUM ('GRADED', 'LECTURER_REVIEWED', 'EXAMINER_APPROVED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PASS', 'FAIL', 'ABSENT', 'WITHHELD');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('CONNECTIVITY', 'TECHNICAL', 'IDENTITY', 'MISCONDUCT', 'ENVIRONMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "KeyActionKind" AS ENUM ('VOID', 'CHANGE_KEY');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "institutions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InstitutionType" NOT NULL,
    "affiliation" "Affiliation" NOT NULL DEFAULT 'CONSTITUENT',
    "city" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'UNDERGRADUATE',
    "durationYrs" INTEGER NOT NULL DEFAULT 5,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePw" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ,
    "lastLoginAt" TIMESTAMPTZ,
    "passwordChangedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_institutions" (
    "userId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,

    CONSTRAINT "user_institutions_pkey" PRIMARY KEY ("userId","institutionId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_history" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "regNo" TEXT NOT NULL,
    "semester" INTEGER NOT NULL,
    "batchYear" INTEGER NOT NULL,
    "dateOfBirth" DATE,
    "guardianPhone" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "term" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "eligibility" "EligibilityStatus" NOT NULL DEFAULT 'ELIGIBLE',
    "attendancePct" DOUBLE PRECISION,
    "eligibilityNote" TEXT,
    "decidedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "type" "QuestionType" NOT NULL DEFAULT 'MCQ',
    "vignette" TEXT,
    "stem" TEXT NOT NULL,
    "explanation" TEXT,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewNote" TEXT,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "courseId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "paperStatus" "PaperStatus" NOT NULL DEFAULT 'DRAFT',
    "paperApprovedBy" UUID,
    "paperApprovedAt" TIMESTAMPTZ,
    "paperReviewNote" TEXT,
    "opensAt" TIMESTAMPTZ NOT NULL,
    "closesAt" TIMESTAMPTZ NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "totalMarks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passPercent" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "negativeMarking" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "instructions" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_institutions" (
    "examId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "venue" TEXT,

    CONSTRAINT "exam_institutions_pkey" PRIMARY KEY ("examId","institutionId")
);

-- CreateTable
CREATE TABLE "exam_questions" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "marks" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "snapshot" JSONB,
    "correctLabel" TEXT,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_candidates" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "extraTimeMin" INTEGER NOT NULL DEFAULT 0,
    "accommodation" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_invigilators" (
    "examId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,

    CONSTRAINT "exam_invigilators_pkey" PRIMARY KEY ("examId","userId","institutionId")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMPTZ NOT NULL,
    "deadlineAt" TIMESTAMPTZ NOT NULL,
    "extraTimeMin" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMPTZ,
    "submitKey" TEXT,
    "receiptCode" TEXT,
    "answerDigest" TEXT,
    "questionOrder" TEXT[],
    "activeClientId" TEXT,
    "clientEpoch" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeatAt" TIMESTAMPTZ,
    "integrityFlags" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_answers" (
    "attemptId" UUID NOT NULL,
    "examQuestionId" UUID NOT NULL,
    "selectedLabel" TEXT,
    "state" "AnswerState" NOT NULL DEFAULT 'SKIPPED',
    "markedForReview" BOOLEAN NOT NULL DEFAULT false,
    "visited" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL,
    "savedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_answers_pkey" PRIMARY KEY ("attemptId","examQuestionId")
);

-- CreateTable
CREATE TABLE "answer_events" (
    "id" BIGSERIAL NOT NULL,
    "attemptId" UUID NOT NULL,
    "examQuestionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "selectedLabel" TEXT,
    "state" "AnswerState" NOT NULL,
    "markedForReview" BOOLEAN NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_events" (
    "id" BIGSERIAL NOT NULL,
    "attemptId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "actorId" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "attemptId" UUID,
    "studentId" UUID,
    "type" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'LOW',
    "description" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "reportedBy" UUID NOT NULL,
    "resolvedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_notes" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_actions" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "examQuestionId" UUID NOT NULL,
    "kind" "KeyActionKind" NOT NULL,
    "newLabel" TEXT,
    "reason" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_batches" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "status" "ResultBatchStatus" NOT NULL DEFAULT 'GRADED',
    "gradedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "examinerApprovedBy" UUID,
    "examinerApprovedAt" TIMESTAMPTZ,
    "publishedBy" UUID,
    "publishedAt" TIMESTAMPTZ,

    CONSTRAINT "result_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "attemptId" UUID,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalMarks" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "status" "ResultStatus" NOT NULL,
    "gradedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "verifyCode" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedBy" UUID NOT NULL,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "seq" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "institutionId" UUID,
    "meta" JSONB,
    "ip" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "institutions_code_key" ON "institutions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_institutionId_code_key" ON "departments"("institutionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "programs_code_key" ON "programs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_programId_semester_idx" ON "courses"("programId", "semester");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "user_institutions_institutionId_idx" ON "user_institutions"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "password_resets_userId_createdAt_idx" ON "password_resets"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "password_history_userId_createdAt_idx" ON "password_history"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "students_userId_key" ON "students"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "students_regNo_key" ON "students"("regNo");

-- CreateIndex
CREATE INDEX "students_institutionId_programId_semester_idx" ON "students"("institutionId", "programId", "semester");

-- CreateIndex
CREATE INDEX "enrollments_courseId_term_idx" ON "enrollments"("courseId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_studentId_courseId_term_key" ON "enrollments"("studentId", "courseId", "term");

-- CreateIndex
CREATE INDEX "questions_courseId_status_idx" ON "questions"("courseId", "status");

-- CreateIndex
CREATE INDEX "questions_institutionId_status_idx" ON "questions"("institutionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_questionId_label_key" ON "question_options"("questionId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "exams_code_key" ON "exams"("code");

-- CreateIndex
CREATE INDEX "exams_status_opensAt_idx" ON "exams"("status", "opensAt");

-- CreateIndex
CREATE INDEX "exam_institutions_institutionId_idx" ON "exam_institutions"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_questions_examId_questionId_key" ON "exam_questions"("examId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_questions_examId_position_key" ON "exam_questions"("examId", "position");

-- CreateIndex
CREATE INDEX "exam_candidates_institutionId_examId_idx" ON "exam_candidates"("institutionId", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_candidates_examId_studentId_key" ON "exam_candidates"("examId", "studentId");

-- CreateIndex
CREATE INDEX "exam_invigilators_userId_idx" ON "exam_invigilators"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_receiptCode_key" ON "attempts"("receiptCode");

-- CreateIndex
CREATE INDEX "attempts_examId_status_idx" ON "attempts"("examId", "status");

-- CreateIndex
CREATE INDEX "attempts_status_deadlineAt_idx" ON "attempts"("status", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_examId_studentId_key" ON "attempts"("examId", "studentId");

-- CreateIndex
CREATE INDEX "answer_events_attemptId_examQuestionId_revision_idx" ON "answer_events"("attemptId", "examQuestionId", "revision");

-- CreateIndex
CREATE INDEX "attempt_events_attemptId_at_idx" ON "attempt_events"("attemptId", "at");

-- CreateIndex
CREATE INDEX "incidents_examId_status_idx" ON "incidents"("examId", "status");

-- CreateIndex
CREATE INDEX "incidents_institutionId_status_idx" ON "incidents"("institutionId", "status");

-- CreateIndex
CREATE INDEX "key_actions_examId_idx" ON "key_actions"("examId");

-- CreateIndex
CREATE UNIQUE INDEX "result_batches_examId_key" ON "result_batches"("examId");

-- CreateIndex
CREATE INDEX "results_studentId_idx" ON "results"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "results_examId_studentId_key" ON "results"("examId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_resultId_key" ON "certificates"("resultId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_serial_key" ON "certificates"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_verifyCode_key" ON "certificates"("verifyCode");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "outbound_messages_status_createdAt_idx" ON "outbound_messages"("status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_institutionId_at_idx" ON "audit_logs"("institutionId", "at");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_at_idx" ON "audit_logs"("actorId", "at");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_institutions" ADD CONSTRAINT "user_institutions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_institutions" ADD CONSTRAINT "user_institutions_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_institutions" ADD CONSTRAINT "exam_institutions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_institutions" ADD CONSTRAINT "exam_institutions_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_invigilators" ADD CONSTRAINT "exam_invigilators_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_examQuestionId_fkey" FOREIGN KEY ("examQuestionId") REFERENCES "exam_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_events" ADD CONSTRAINT "attempt_events_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_notes" ADD CONSTRAINT "incident_notes_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_actions" ADD CONSTRAINT "key_actions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_actions" ADD CONSTRAINT "key_actions_examQuestionId_fkey" FOREIGN KEY ("examQuestionId") REFERENCES "exam_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_batches" ADD CONSTRAINT "result_batches_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
