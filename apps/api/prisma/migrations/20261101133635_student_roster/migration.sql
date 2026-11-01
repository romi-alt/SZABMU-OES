-- CreateTable
CREATE TABLE "roster_entries" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "regNo" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "semester" INTEGER NOT NULL,
    "batchYear" INTEGER NOT NULL,
    "claimedAt" TIMESTAMPTZ,
    "claimedByUserId" UUID,
    "importedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roster_entries_regNo_key" ON "roster_entries"("regNo");

-- CreateIndex
CREATE INDEX "roster_entries_institutionId_claimedAt_idx" ON "roster_entries"("institutionId", "claimedAt");

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
