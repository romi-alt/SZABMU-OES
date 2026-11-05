-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('ADMITTED', 'REVOKED');

-- AlterTable
ALTER TABLE "attempts" ADD COLUMN     "admission" JSONB;

-- AlterTable
ALTER TABLE "exam_candidates" ADD COLUMN     "decisionSource" TEXT NOT NULL DEFAULT 'ENROLMENT',
ADD COLUMN     "rosterVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "status" "CandidateStatus" NOT NULL DEFAULT 'ADMITTED',
ADD COLUMN     "statusChangedAt" TIMESTAMPTZ,
ADD COLUMN     "statusReason" TEXT;

-- CreateTable
CREATE TABLE "exam_roster_versions" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "approvedById" UUID NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "revokedCount" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_roster_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_overrides" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "attemptId" UUID,
    "oldDecision" TEXT NOT NULL,
    "newDecision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eligibility_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_roster_versions_examId_version_key" ON "exam_roster_versions"("examId", "version");

-- CreateIndex
CREATE INDEX "eligibility_overrides_examId_studentId_idx" ON "eligibility_overrides"("examId", "studentId");

-- AddForeignKey
ALTER TABLE "exam_roster_versions" ADD CONSTRAINT "exam_roster_versions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_overrides" ADD CONSTRAINT "eligibility_overrides_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_overrides" ADD CONSTRAINT "eligibility_overrides_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_overrides" ADD CONSTRAINT "eligibility_overrides_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Roster versions and eligibility overrides are evidence: append-only.
CREATE TRIGGER exam_roster_versions_append_only BEFORE UPDATE OR DELETE ON exam_roster_versions
  FOR EACH ROW EXECUTE FUNCTION oes_forbid_mutation();
CREATE TRIGGER eligibility_overrides_append_only BEFORE UPDATE OR DELETE ON eligibility_overrides
  FOR EACH ROW EXECUTE FUNCTION oes_forbid_mutation();

ALTER TABLE eligibility_overrides ADD CONSTRAINT eligibility_overrides_decisions_chk
  CHECK (length(btrim(reason)) >= 10 AND "oldDecision" <> "newDecision");
