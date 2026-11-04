-- Teacher self-registration, question pools and student onboarding (MySQL port of the PostgreSQL migrations
-- 20261102175907_teacher_registration_and_pools and 20261102184725_student_onboarding, archived in prisma/migrations-postgres-archive).
-- AlterTable
ALTER TABLE `audit_logs` MODIFY `actorRole` ENUM('TEACHER', 'STUDENT', 'LECTURER', 'EXAMINER', 'CAMPUS_ADMIN', 'INVIGILATOR', 'CCE', 'SUPER_ADMIN') NULL;

-- AlterTable
ALTER TABLE `course_assignments` ADD COLUMN `decidedAt` DATETIME(3) NULL,
    ADD COLUMN `decidedById` CHAR(36) NULL,
    ADD COLUMN `decisionNote` TEXT NULL,
    ADD COLUMN `requestedAt` DATETIME(3) NULL,
    ADD COLUMN `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'REVOKED') NOT NULL DEFAULT 'APPROVED',
    ADD COLUMN `term` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `questions` ADD COLUMN `defaultMarks` DOUBLE NOT NULL DEFAULT 1,
    ADD COLUMN `poolId` CHAR(36) NULL,
    ADD COLUMN `topic` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `students` ADD COLUMN `fatherName` VARCHAR(191) NULL,
    ADD COLUMN `gender` VARCHAR(191) NULL,
    ADD COLUMN `photo` LONGBLOB NULL,
    ADD COLUMN `photoMime` VARCHAR(191) NULL,
    ADD COLUMN `profileCompletedAt` DATETIME(3) NULL,
    ADD COLUMN `selfDeclared` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `users` MODIFY `role` ENUM('TEACHER', 'STUDENT', 'LECTURER', 'EXAMINER', 'CAMPUS_ADMIN', 'INVIGILATOR', 'CCE', 'SUPER_ADMIN') NOT NULL;

-- CreateTable
CREATE TABLE `teacher_profiles` (
    `userId` CHAR(36) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `designation` VARCHAR(191) NOT NULL,
    `photo` LONGBLOB NULL,
    `photoMime` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED') NOT NULL DEFAULT 'PENDING',
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `suspendedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `teacher_profiles_employeeId_key`(`employeeId`),
    INDEX `teacher_profiles_status_idx`(`status`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_pools` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `term` VARCHAR(100) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `archivedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `question_pools_ownerId_archivedAt_idx`(`ownerId`, `archivedAt`),
    INDEX `question_pools_courseId_institutionId_idx`(`courseId`, `institutionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_signups` (
    `userId` CHAR(36) NOT NULL,
    `regNo` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `student_signups_regNo_key`(`regNo`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `course_assignments_status_institutionId_idx` ON `course_assignments`(`status`, `institutionId`);

-- CreateIndex
CREATE INDEX `questions_poolId_idx` ON `questions`(`poolId`);

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_poolId_fkey` FOREIGN KEY (`poolId`) REFERENCES `question_pools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_profiles` ADD CONSTRAINT `teacher_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_signups` ADD CONSTRAINT `student_signups_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- The one-active-assignment rule now also covers the academic session and ignores rejected/revoked requests, so a teacher can request
-- the same subject for different terms and can re-request after a rejection. PostgreSQL used a partial unique index on
-- (userId, courseId, institutionId, COALESCE(term, '')) WHERE revokedAt IS NULL AND status IN ('PENDING', 'APPROVED'); here the
-- condition is a generated flag (1 or NULL — NULLs never collide in a UNIQUE key) and the term a generated, never-NULL key.
-- Existing rows (status APPROVED, term NULL) keep exactly the old meaning.
DROP INDEX `course_assignments_active_uniq` ON `course_assignments`;
ALTER TABLE `course_assignments` DROP COLUMN `activeKey`;
ALTER TABLE `course_assignments`
  ADD COLUMN `activeKey` TINYINT AS (IF(`revokedAt` IS NULL AND `status` IN ('PENDING', 'APPROVED'), 1, NULL)) VIRTUAL,
  ADD COLUMN `termKey` VARCHAR(100) AS (IFNULL(`term`, '')) VIRTUAL;
CREATE UNIQUE INDEX `course_assignments_active_uniq` ON `course_assignments`(`userId`, `courseId`, `institutionId`, `termKey`, `activeKey`);

-- student_signups.regNo is unique whatever its letter case: the column's utf8mb4_unicode_ci collation already compares
-- case-insensitively (PostgreSQL needed an extra unique index on lower("regNo")).
