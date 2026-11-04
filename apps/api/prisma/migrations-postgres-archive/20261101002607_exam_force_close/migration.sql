-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "forceCloseAt" TIMESTAMPTZ;

-- RenameIndex
ALTER INDEX "exam_candidates_exam_inst_idx" RENAME TO "exam_candidates_examId_institutionId_idx";
