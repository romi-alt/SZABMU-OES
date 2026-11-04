-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "paperSubmittedBy" UUID,
ADD COLUMN     "term" TEXT NOT NULL DEFAULT '2026-SPRING';

-- AlterTable
ALTER TABLE "result_batches" ADD COLUMN     "reviewNote" TEXT;
CREATE SEQUENCE IF NOT EXISTS certificate_serial_seq START 1000;
