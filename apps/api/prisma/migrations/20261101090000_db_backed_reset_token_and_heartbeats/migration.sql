-- Redis removal (web-hosting deployment): the two pieces of state that must be durable move into the database.

-- Password-reset token: single-use, stored hashed, with its own expiry.
ALTER TABLE "password_resets" ADD COLUMN "tokenHash" TEXT, ADD COLUMN "tokenExpiresAt" TIMESTAMPTZ;
CREATE UNIQUE INDEX "password_resets_tokenHash_key" ON "password_resets"("tokenHash");

-- Latest heartbeat per attempt.
CREATE TABLE "attempt_heartbeats" (
  "attemptId" UUID NOT NULL,
  "examId" UUID NOT NULL,
  "seenAt" TIMESTAMPTZ NOT NULL,
  "online" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "attempt_heartbeats_pkey" PRIMARY KEY ("attemptId")
);
CREATE INDEX "attempt_heartbeats_examId_idx" ON "attempt_heartbeats"("examId");
