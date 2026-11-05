-- CreateEnum
CREATE TYPE "TimingPolicy" AS ENUM ('INDIVIDUAL', 'SYNCHRONIZED');

-- CreateEnum
CREATE TYPE "ControlMode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "SuspendTimePolicy" AS ENUM ('FREEZE_CLOCK', 'CLOCK_CONTINUES');

-- CreateEnum
CREATE TYPE "SuspensionScope" AS ENUM ('EXAM', 'CAMPUS', 'CANDIDATES');

-- CreateEnum
CREATE TYPE "ExtensionScope" AS ENUM ('CANDIDATES', 'CAMPUS', 'EXAM');

-- CreateEnum
CREATE TYPE "EventDelivery" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExamStatus" ADD VALUE 'ADMISSION_OPEN';
ALTER TYPE "ExamStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "ExamStatus" ADD VALUE 'CLOSING';
ALTER TYPE "ExamStatus" ADD VALUE 'SCORING';

-- AlterTable
ALTER TABLE "attempts" ADD COLUMN     "lifecycleError" TEXT,
ADD COLUMN     "lifecycleRetries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "suspendedAt" TIMESTAMPTZ,
ADD COLUMN     "suspensionId" UUID;

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "admissionClosedAt" TIMESTAMPTZ,
ADD COLUMN     "admissionOpenedAt" TIMESTAMPTZ,
ADD COLUMN     "closedAt" TIMESTAMPTZ,
ADD COLUMN     "controlMode" "ControlMode" NOT NULL DEFAULT 'AUTOMATIC',
ADD COLUMN     "controlPolicyApprovedAt" TIMESTAMPTZ,
ADD COLUMN     "controlPolicyApprovedBy" UUID,
ADD COLUMN     "officialStartAt" TIMESTAMPTZ,
ADD COLUMN     "stateVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "suspendTimePolicy" "SuspendTimePolicy",
ADD COLUMN     "timingPolicy" "TimingPolicy" NOT NULL DEFAULT 'INDIVIDUAL';

-- CreateTable
CREATE TABLE "exam_suspensions" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "scope" "SuspensionScope" NOT NULL,
    "institutionId" UUID,
    "studentIds" UUID[],
    "reason" TEXT NOT NULL,
    "incidentId" UUID,
    "timePolicy" "SuspendTimePolicy" NOT NULL,
    "suspendedBy" UUID NOT NULL,
    "suspendedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "resumedBy" UUID,
    "resumedAt" TIMESTAMPTZ,
    "resumeNote" TEXT,
    "pausedSeconds" INTEGER,

    CONSTRAINT "exam_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_extensions" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "scope" "ExtensionScope" NOT NULL,
    "institutionId" UUID,
    "studentIds" UUID[],
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedBy" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "affectedCount" INTEGER NOT NULL,
    "closesAtBefore" TIMESTAMPTZ,
    "closesAtAfter" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_commands" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_events" (
    "id" BIGSERIAL NOT NULL,
    "eventId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "institutionId" UUID,
    "studentId" UUID,
    "aggregateVersion" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "deliveryStatus" "EventDelivery" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMPTZ,

    CONSTRAINT "exam_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lifecycle_leases" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lifecycle_leases_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "lifecycle_runs" (
    "id" UUID NOT NULL,
    "instance" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    "finishedAt" TIMESTAMPTZ,
    "durationMs" INTEGER,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,

    CONSTRAINT "lifecycle_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_suspensions_examId_resumedAt_idx" ON "exam_suspensions"("examId", "resumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "exam_extensions_examId_idempotencyKey_key" ON "exam_extensions"("examId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "exam_commands_examId_idempotencyKey_key" ON "exam_commands"("examId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "exam_events_eventId_key" ON "exam_events"("eventId");

-- CreateIndex
CREATE INDEX "exam_events_examId_id_idx" ON "exam_events"("examId", "id");

-- CreateIndex
CREATE INDEX "exam_events_deliveryStatus_id_idx" ON "exam_events"("deliveryStatus", "id");

-- CreateIndex
CREATE INDEX "lifecycle_runs_startedAt_idx" ON "lifecycle_runs"("startedAt");

-- CreateIndex
CREATE INDEX "attempts_examId_suspensionId_idx" ON "attempts"("examId", "suspensionId");

-- CreateIndex
CREATE INDEX "exams_status_closesAt_idx" ON "exams"("status", "closesAt");

-- AddForeignKey
ALTER TABLE "exam_suspensions" ADD CONSTRAINT "exam_suspensions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_extensions" ADD CONSTRAINT "exam_extensions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_commands" ADD CONSTRAINT "exam_commands_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_events" ADD CONSTRAINT "exam_events_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── hand-written additions (integrity + indexes) ─────────────────────────────────────────────
-- exam_events is an append-only transition log: rows are never deleted and only the delivery bookkeeping may change.
CREATE OR REPLACE FUNCTION exam_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'exam_events is append-only'; END IF;
  IF (NEW.id, NEW."eventId", NEW."examId", NEW."institutionId", NEW."studentId", NEW."aggregateVersion", NEW.type, NEW.payload, NEW."createdAt")
     IS DISTINCT FROM (OLD.id, OLD."eventId", OLD."examId", OLD."institutionId", OLD."studentId", OLD."aggregateVersion", OLD.type, OLD.payload, OLD."createdAt") THEN
    RAISE EXCEPTION 'exam_events: only delivery fields may be updated';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER exam_events_guard_t BEFORE UPDATE OR DELETE ON exam_events FOR EACH ROW EXECUTE FUNCTION exam_events_guard();

ALTER TABLE exam_extensions ADD CONSTRAINT exam_extensions_minutes_chk CHECK (minutes BETWEEN 1 AND 240);
ALTER TABLE exam_suspensions ADD CONSTRAINT exam_suspensions_scope_chk CHECK (
  (scope = 'EXAM') OR (scope = 'CAMPUS' AND "institutionId" IS NOT NULL) OR (scope = 'CANDIDATES' AND cardinality("studentIds") > 0));

CREATE INDEX exam_events_pending_idx ON exam_events (id) WHERE "deliveryStatus" = 'PENDING';
CREATE INDEX IF NOT EXISTS exam_candidates_exam_inst_idx ON exam_candidates ("examId", "institutionId");
CREATE INDEX exam_suspensions_open_idx ON exam_suspensions ("examId") WHERE "resumedAt" IS NULL;
CREATE INDEX attempts_suspended_idx ON attempts ("examId") WHERE "suspendedAt" IS NOT NULL;
