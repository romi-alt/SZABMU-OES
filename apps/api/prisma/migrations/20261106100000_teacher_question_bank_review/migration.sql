-- Teacher portal, step 2: question-bank review state, richer MCQ metadata, question images and an append-only version history.
-- ADDITIVE ONLY: new nullable/defaulted columns, two new tables, indexes, two foreign keys, one data backfill and two triggers on a NEW table.
-- Nothing is dropped, renamed or narrowed. (A Prisma diff of the current schema also proposes dropping the course_assignments unique index and
-- generated columns and question_options.correctFlag / its one-correct index; those are hand-written protections Prisma does not model and are
-- deliberately NOT touched here.)

-- Bank-level review state. New banks start DRAFT; existing banks are backfilled below.
ALTER TABLE `question_pools`
    ADD COLUMN `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `reviewNote` TEXT NULL,
    ADD COLUMN `reviewedById` CHAR(36) NULL,
    ADD COLUMN `reviewedAt` DATETIME(3) NULL;

-- Optional MCQ metadata.
ALTER TABLE `questions`
    ADD COLUMN `subtopic` VARCHAR(191) NULL,
    ADD COLUMN `bloom` ENUM('REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYZE', 'EVALUATE', 'CREATE') NULL,
    ADD COLUMN `imageId` CHAR(36) NULL;

-- Images/diagrams for question stems (kept in the database: hosted file systems are not durable across deploys).
CREATE TABLE `question_images` (
    `id` CHAR(36) NOT NULL,
    `uploadedById` CHAR(36) NOT NULL,
    `mime` VARCHAR(40) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `data` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `question_images_uploadedById_idx`(`uploadedById`),
    INDEX `question_images_sha256_idx`(`sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Author-facing content history, one row per question version.
CREATE TABLE `question_versions` (
    `id` CHAR(36) NOT NULL,
    `questionId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `changedById` CHAR(36) NOT NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `question_versions_changedById_createdAt_idx`(`changedById`, `createdAt`),
    UNIQUE INDEX `question_versions_questionId_version_key`(`questionId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Indexes for the review queue, the teacher's own lists and the Overview/Submissions counts.
CREATE INDEX `question_pools_status_institutionId_idx` ON `question_pools`(`status`, `institutionId`);
CREATE INDEX `question_pools_ownerId_status_idx` ON `question_pools`(`ownerId`, `status`);
CREATE INDEX `questions_poolId_status_idx` ON `questions`(`poolId`, `status`);
CREATE INDEX `questions_authorId_status_idx` ON `questions`(`authorId`, `status`);

-- Foreign keys. A deleted image only clears the reference; history can never be orphaned or cascaded away.
ALTER TABLE `questions` ADD CONSTRAINT `questions_imageId_fkey` FOREIGN KEY (`imageId`) REFERENCES `question_images`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `question_versions` ADD CONSTRAINT `question_versions_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `questions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Backfill: give each existing bank the state its questions already imply (any under review → SUBMITTED, else any returned → REJECTED,
-- else any draft → DRAFT, else any approved → APPROVED, else DRAFT). Only rows of question_pools change; no question is touched.
UPDATE `question_pools` p SET p.`status` = CASE
    WHEN EXISTS (SELECT 1 FROM `questions` q WHERE q.`poolId` = p.`id` AND q.`status` = 'SUBMITTED') THEN 'SUBMITTED'
    WHEN EXISTS (SELECT 1 FROM `questions` q WHERE q.`poolId` = p.`id` AND q.`status` = 'REJECTED') THEN 'REJECTED'
    WHEN EXISTS (SELECT 1 FROM `questions` q WHERE q.`poolId` = p.`id` AND q.`status` = 'DRAFT') THEN 'DRAFT'
    WHEN EXISTS (SELECT 1 FROM `questions` q WHERE q.`poolId` = p.`id` AND q.`status` = 'APPROVED') THEN 'APPROVED'
    ELSE 'DRAFT' END;

-- Version history is append-only evidence (same pattern as audit_logs).
CREATE TRIGGER `question_versions_no_update` BEFORE UPDATE ON `question_versions` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'question_versions is append-only';
CREATE TRIGGER `question_versions_no_delete` BEFORE DELETE ON `question_versions` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'question_versions is append-only';
