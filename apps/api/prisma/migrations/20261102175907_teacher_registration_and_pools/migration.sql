-- CreateEnum
CREATE TYPE "TeacherStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'TEACHER';

-- AlterTable
ALTER TABLE "course_assignments" ADD COLUMN     "decidedAt" TIMESTAMPTZ,
ADD COLUMN     "decidedById" UUID,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "requestedAt" TIMESTAMPTZ,
ADD COLUMN     "status" "AssignmentStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "term" TEXT;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "defaultMarks" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "poolId" UUID,
ADD COLUMN     "topic" TEXT;

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "userId" UUID NOT NULL,
    "employeeId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "photo" BYTEA,
    "photoMime" TEXT,
    "status" "TeacherStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "reviewNote" TEXT,
    "suspendedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "question_pools" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "term" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMPTZ,
    "submittedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "question_pools_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_employeeId_key" ON "teacher_profiles"("employeeId");

-- CreateIndex
CREATE INDEX "teacher_profiles_status_idx" ON "teacher_profiles"("status");

-- CreateIndex
CREATE INDEX "question_pools_ownerId_archivedAt_idx" ON "question_pools"("ownerId", "archivedAt");

-- CreateIndex
CREATE INDEX "question_pools_courseId_institutionId_idx" ON "question_pools"("courseId", "institutionId");

-- CreateIndex
CREATE INDEX "questions_poolId_idx" ON "questions"("poolId");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "question_pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The one-active-assignment rule now also covers the academic session and ignores rejected/revoked requests, so a teacher can
-- request the same subject for different terms and can re-request after a rejection. Existing rows (status APPROVED, term NULL) are unaffected.
DROP INDEX IF EXISTS course_assignments_active_uniq;
CREATE UNIQUE INDEX course_assignments_active_uniq ON course_assignments ("userId", "courseId", "institutionId", COALESCE("term", ''))
  WHERE "revokedAt" IS NULL AND "status" IN ('PENDING', 'APPROVED');
CREATE INDEX "course_assignments_status_institutionId_idx" ON course_assignments ("status", "institutionId");
