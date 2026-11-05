-- AlterTable
ALTER TABLE "students" ADD COLUMN     "fatherName" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "photo" BYTEA,
ADD COLUMN     "photoMime" TEXT,
ADD COLUMN     "profileCompletedAt" TIMESTAMPTZ,
ADD COLUMN     "selfDeclared" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "student_signups" (
    "userId" UUID NOT NULL,
    "regNo" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,

    CONSTRAINT "student_signups_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_signups_regNo_key" ON "student_signups"("regNo");

-- AddForeignKey
ALTER TABLE "student_signups" ADD CONSTRAINT "student_signups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A registration number may be reserved by only one signup, whatever its letter case.
CREATE UNIQUE INDEX student_signups_regno_lower_uniq ON student_signups (lower("regNo"));
