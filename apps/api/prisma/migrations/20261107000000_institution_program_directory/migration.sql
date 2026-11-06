-- Institution & programme directory (ADDITIVE ONLY).
-- New nullable/defaulted columns, new tables, indexes and foreign keys, plus three small data steps at the end:
--   1. the SZABMU awarding body;
--   2. explicit demo flags on the three synthetic institutions and the four synthetic courses of the demo seed;
--   3. one LEGACY_UNVERIFIED offering for every institution-programme relationship that already exists in the data
--      (students, official register, lecturer assignments), so nothing that works today stops working.
-- Nothing is dropped, renamed or narrowed. (A raw Prisma diff also proposes dropping course_assignments_active_uniq, the generated
-- activeKey/termKey/correctFlag columns, question_options_one_correct and two unrelated foreign keys: hand-written protections
-- Prisma does not model. They are deliberately NOT touched here.)

-- AlterTable
ALTER TABLE `courses` ADD COLUMN `isDemo` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `institutions` ADD COLUMN `abbreviation` VARCHAR(40) NULL,
    ADD COLUMN `campusLabel` VARCHAR(150) NULL,
    ADD COLUMN `directoryKey` VARCHAR(80) NULL,
    ADD COLUMN `isDemo` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `kind` ENUM('INSTITUTION', 'ACADEMIC_UNIT') NOT NULL DEFAULT 'INSTITUTION',
    ADD COLUMN `lastVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `listingStatus` ENUM('LISTED', 'NEEDS_VERIFICATION', 'HIDDEN') NOT NULL DEFAULT 'LISTED',
    ADD COLUMN `lockedFields` JSON NULL,
    ADD COLUMN `operationalStatus` ENUM('OPERATING', 'UNKNOWN', 'CLOSED') NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN `region` VARCHAR(100) NULL,
    ADD COLUMN `sector` ENUM('PUBLIC', 'PRIVATE') NULL,
    ADD COLUMN `sourceName` VARCHAR(255) NULL,
    MODIFY `type` ENUM('MEDICAL_COLLEGE', 'DENTAL_COLLEGE', 'NURSING_COLLEGE', 'ALLIED_HEALTH', 'TEACHING_HOSPITAL', 'AFFILIATED_INSTITUTE', 'NURSING_SCHOOL', 'HOSPITAL', 'REHABILITATION_INSTITUTE', 'HEALTH_SCIENCES_INSTITUTE', 'MEDICAL_DENTAL_COLLEGE', 'COLLEGE', 'INSTITUTE') NOT NULL;

-- AlterTable
ALTER TABLE `programs` ADD COLUMN `catalogScope` ENUM('AFFILIATION', 'UNIVERSITY_CATALOGUE') NOT NULL DEFAULT 'AFFILIATION',
    ADD COLUMN `durationMonths` INTEGER NULL,
    ADD COLUMN `isDemo` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `directoryKey` VARCHAR(60) NULL,
    ADD COLUMN `lockedFields` JSON NULL,
    ADD COLUMN `sourceTitle` VARCHAR(255) NULL,
    ADD COLUMN `structure` VARCHAR(20) NULL,
    ADD COLUMN `verificationStatus` ENUM('VERIFIED', 'NEEDS_VERIFICATION', 'LEGACY_UNVERIFIED', 'UNLISTED') NOT NULL DEFAULT 'LEGACY_UNVERIFIED';

-- AlterTable
ALTER TABLE `students` ADD COLUMN `shift` ENUM('UNSPECIFIED', 'MORNING', 'EVENING') NULL;

-- CreateTable
CREATE TABLE `awarding_bodies` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `kind` ENUM('UNIVERSITY', 'REGULATOR', 'PROFESSIONAL_COLLEGE', 'OTHER') NOT NULL,
    `isSzabmu` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

UNIQUE INDEX `awarding_bodies_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `institution_program_offerings` (
    `id` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `programId` CHAR(36) NOT NULL,
    `awardingBodyId` CHAR(36) NOT NULL,
    `verificationStatus` ENUM('VERIFIED', 'NEEDS_VERIFICATION', 'LEGACY_UNVERIFIED', 'UNLISTED') NOT NULL DEFAULT 'NEEDS_VERIFICATION',
    `intakeStatus` ENUM('UNRESTRICTED', 'STOPPED') NOT NULL DEFAULT 'UNRESTRICTED',
    `intakeStoppedFromBatchYear` INTEGER NULL,
    `sourceTitle` VARCHAR(255) NULL,
    `lockedFields` JSON NULL,
    `createdByRunId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

INDEX `institution_program_offerings_programId_idx`(`programId`),
    INDEX `institution_program_offerings_verificationStatus_intakeStatu_idx`(`verificationStatus`, `intakeStatus`),
    UNIQUE INDEX `institution_program_offerings_institutionId_programId_key`(`institutionId`, `programId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offering_allocations` (
    `id` CHAR(36) NOT NULL,
    `offeringId` CHAR(36) NOT NULL,
    `shift` ENUM('UNSPECIFIED', 'MORNING', 'EVENING') NOT NULL DEFAULT 'UNSPECIFIED',
    `annualSeats` INTEGER NULL,
    `sourceId` CHAR(36) NULL,

UNIQUE INDEX `offering_allocations_offeringId_shift_key`(`offeringId`, `shift`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offering_sessions` (
    `id` CHAR(36) NOT NULL,
    `offeringId` CHAR(36) NOT NULL,
    `batchYear` INTEGER NOT NULL,
    `label` VARCHAR(100) NULL,
    `admissionsStatus` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'CLOSED',
    `seatLimit` INTEGER NULL,
    `note` TEXT NULL,
    `configuredById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

UNIQUE INDEX `offering_sessions_offeringId_batchYear_key`(`offeringId`, `batchYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `directory_sources` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `retrievedAt` DATETIME(3) NOT NULL,
    `contentSha256` CHAR(64) NULL,
    `note` TEXT NULL,

UNIQUE INDEX `directory_sources_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `directory_claims` (
    `id` CHAR(36) NOT NULL,
    `claimKey` VARCHAR(191) NOT NULL,
    `entityType` ENUM('INSTITUTION', 'PROGRAM', 'OFFERING', 'ALLOCATION', 'RESTRICTION', 'RELATIONSHIP', 'CURRICULUM') NOT NULL,
    `entityId` CHAR(36) NULL,
    `entityKey` VARCHAR(191) NOT NULL,
    `claimType` VARCHAR(60) NOT NULL,
    `text` TEXT NOT NULL,
    `status` ENUM('VERIFIED', 'UNRESOLVED', 'DISCREPANCY') NOT NULL DEFAULT 'VERIFIED',
    `sourceId` CHAR(36) NOT NULL,
    `sessionLabel` VARCHAR(100) NULL,
    `effectiveFrom` DATE NULL,
    `retrievedAt` DATETIME(3) NOT NULL,
    `importRunId` CHAR(36) NULL,

UNIQUE INDEX `directory_claims_claimKey_key`(`claimKey`),
    INDEX `directory_claims_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `directory_claims_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `program_aliases` (
    `id` CHAR(36) NOT NULL,
    `programId` CHAR(36) NOT NULL,
    `alias` VARCHAR(255) NOT NULL,
    `note` TEXT NULL,
    `sourceId` CHAR(36) NULL,

UNIQUE INDEX `program_aliases_programId_alias_key`(`programId`, `alias`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curriculum_documents` (
    `id` CHAR(36) NOT NULL,
    `programId` CHAR(36) NULL,
    `title` VARCHAR(255) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `appliesTo` VARCHAR(150) NULL,
    `versionLabel` VARCHAR(100) NULL,
    `sourceId` CHAR(36) NOT NULL,
    `retrievedAt` DATETIME(3) NOT NULL,

INDEX `curriculum_documents_programId_idx`(`programId`),
    UNIQUE INDEX `curriculum_documents_url_key`(`url`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `directory_import_runs` (
    `id` CHAR(36) NOT NULL,
    `version` VARCHAR(40) NOT NULL,
    `mode` ENUM('DRY_RUN', 'APPLY', 'ROLLBACK') NOT NULL,
    `status` ENUM('RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `actor` VARCHAR(120) NOT NULL,
    `datasetSha256` CHAR(64) NULL,
    `summary` JSON NULL,
    `error` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

INDEX `directory_import_runs_version_startedAt_idx`(`version`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `directory_import_changes` (
    `id` CHAR(36) NOT NULL,
    `runId` CHAR(36) NOT NULL,
    `entity` VARCHAR(40) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,

INDEX `directory_import_changes_runId_idx`(`runId`),
    INDEX `directory_import_changes_entity_entityId_idx`(`entity`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `institutions_directoryKey_key` ON `institutions`(`directoryKey`);

-- CreateIndex
CREATE INDEX `institutions_isDemo_kind_idx` ON `institutions`(`isDemo`, `kind`);

-- CreateIndex
CREATE INDEX `institutions_sector_affiliation_idx` ON `institutions`(`sector`, `affiliation`);

-- CreateIndex
CREATE UNIQUE INDEX `programs_directoryKey_key` ON `programs`(`directoryKey`);

-- AddForeignKey
ALTER TABLE `institution_program_offerings` ADD CONSTRAINT `institution_program_offerings_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `institution_program_offerings` ADD CONSTRAINT `institution_program_offerings_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `institution_program_offerings` ADD CONSTRAINT `institution_program_offerings_awardingBodyId_fkey` FOREIGN KEY (`awardingBodyId`) REFERENCES `awarding_bodies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `offering_allocations` ADD CONSTRAINT `offering_allocations_offeringId_fkey` FOREIGN KEY (`offeringId`) REFERENCES `institution_program_offerings`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `offering_sessions` ADD CONSTRAINT `offering_sessions_offeringId_fkey` FOREIGN KEY (`offeringId`) REFERENCES `institution_program_offerings`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `directory_claims` ADD CONSTRAINT `directory_claims_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `directory_sources`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `program_aliases` ADD CONSTRAINT `program_aliases_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `programs`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `curriculum_documents` ADD CONSTRAINT `curriculum_documents_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `programs`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `directory_import_changes` ADD CONSTRAINT `directory_import_changes_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `directory_import_runs`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ── data step 1: the awarding university ──
INSERT INTO `awarding_bodies` (`id`, `key`, `name`, `kind`, `isSzabmu`)
VALUES (UUID(), 'szabmu', 'Shaheed Zulfiqar Ali Bhutto Medical University (SZABMU)', 'UNIVERSITY', true);

-- ── data step 2: explicit demo flags (confirmed synthetic: reserved demo codes AND the "(synthetic)" name suffix) ──
UPDATE `institutions` SET `isDemo` = true WHERE `code` IN ('DMC-A', 'DMC-B', 'DNC-C') AND `name` LIKE '%(synthetic)';
UPDATE `courses` SET `isDemo` = true WHERE `code` IN ('MBBS-PATH-4', 'MBBS-PHARM-4', 'MBBS-ANAT-1', 'BSN-FUND-1');

-- ── data step 3: keep every existing institution-programme relationship, flagged for review ──
INSERT INTO `institution_program_offerings` (`id`, `institutionId`, `programId`, `awardingBodyId`, `verificationStatus`, `intakeStatus`, `createdAt`, `updatedAt`)
SELECT UUID(), pairs.`institutionId`, pairs.`programId`, (SELECT `id` FROM `awarding_bodies` WHERE `key` = 'szabmu'), 'LEGACY_UNVERIFIED', 'UNRESTRICTED', NOW(3), NOW(3)
FROM (
  SELECT `institutionId`, `programId` FROM `students`
  UNION SELECT `institutionId`, `programId` FROM `roster_entries`
  UNION SELECT ca.`institutionId`, c.`programId` FROM `course_assignments` ca JOIN `courses` c ON c.`id` = ca.`courseId`
) pairs;
