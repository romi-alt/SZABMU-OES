-- CreateTable
CREATE TABLE `institutions` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('MEDICAL_COLLEGE', 'DENTAL_COLLEGE', 'NURSING_COLLEGE', 'ALLIED_HEALTH', 'TEACHING_HOSPITAL', 'AFFILIATED_INSTITUTE') NOT NULL,
    `affiliation` ENUM('CONSTITUENT', 'AFFILIATED') NOT NULL DEFAULT 'CONSTITUENT',
    `city` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `institutions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `departments_institutionId_code_key`(`institutionId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `programs` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `level` VARCHAR(191) NOT NULL DEFAULT 'UNDERGRADUATE',
    `durationYrs` INTEGER NOT NULL DEFAULT 5,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `programs_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courses` (
    `id` CHAR(36) NOT NULL,
    `programId` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `semester` INTEGER NOT NULL,
    `credits` INTEGER NOT NULL DEFAULT 3,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `courses_code_key`(`code`),
    INDEX `courses_programId_semester_idx`(`programId`, `semester`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `role` ENUM('STUDENT', 'LECTURER', 'EXAMINER', 'CAMPUS_ADMIN', 'INVIGILATOR', 'CCE', 'SUPER_ADMIN') NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `mustChangePw` BOOLEAN NOT NULL DEFAULT false,
    `totpSecretEnc` VARCHAR(191) NULL,
    `totpEnabledAt` DATETIME(3) NULL,
    `totpLastStep` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `failedLogins` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `passwordChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_institutions` (
    `userId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,

    INDEX `user_institutions_institutionId_idx`(`institutionId`),
    PRIMARY KEY (`userId`, `institutionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `mfaVerifiedAt` DATETIME(3) NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,

    UNIQUE INDEX `sessions_tokenHash_key`(`tokenHash`),
    INDEX `sessions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_resets` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `password_resets_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_history` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `password_history_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roster_entries` (
    `id` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `programId` CHAR(36) NOT NULL,
    `regNo` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `dateOfBirth` DATE NOT NULL,
    `semester` INTEGER NOT NULL,
    `batchYear` INTEGER NOT NULL,
    `claimedAt` DATETIME(3) NULL,
    `claimedByUserId` CHAR(36) NULL,
    `importedBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `roster_entries_regNo_key`(`regNo`),
    INDEX `roster_entries_institutionId_claimedAt_idx`(`institutionId`, `claimedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `students` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `programId` CHAR(36) NOT NULL,
    `regNo` VARCHAR(191) NOT NULL,
    `semester` INTEGER NOT NULL,
    `batchYear` INTEGER NOT NULL,
    `dateOfBirth` DATE NULL,
    `guardianPhone` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `students_userId_key`(`userId`),
    UNIQUE INDEX `students_regNo_key`(`regNo`),
    INDEX `students_institutionId_programId_semester_idx`(`institutionId`, `programId`, `semester`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enrollments` (
    `id` CHAR(36) NOT NULL,
    `studentId` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `term` VARCHAR(191) NOT NULL,
    `status` ENUM('ENROLLED', 'WITHDRAWN', 'COMPLETED') NOT NULL DEFAULT 'ENROLLED',
    `eligibility` ENUM('ELIGIBLE', 'INELIGIBLE', 'CONDONED') NOT NULL DEFAULT 'ELIGIBLE',
    `attendancePct` DOUBLE NULL,
    `eligibilityNote` TEXT NULL,
    `decidedBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `enrollments_courseId_term_idx`(`courseId`, `term`),
    UNIQUE INDEX `enrollments_studentId_courseId_term_key`(`studentId`, `courseId`, `term`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `questions` (
    `id` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `authorId` CHAR(36) NOT NULL,
    `type` ENUM('MCQ', 'CLINICAL_MCQ') NOT NULL DEFAULT 'MCQ',
    `vignette` TEXT NULL,
    `stem` TEXT NOT NULL,
    `explanation` TEXT NULL,
    `difficulty` ENUM('EASY', 'MEDIUM', 'HARD') NOT NULL DEFAULT 'MEDIUM',
    `tags` JSON NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `reviewNote` TEXT NULL,
    `reviewedBy` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `questions_courseId_status_idx`(`courseId`, `status`),
    INDEX `questions_institutionId_status_idx`(`institutionId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_options` (
    `id` CHAR(36) NOT NULL,
    `questionId` CHAR(36) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `isCorrect` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `question_options_questionId_label_key`(`questionId`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exams` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `createdBy` CHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'PAPER_PENDING', 'APPROVED', 'SCHEDULED', 'LIVE', 'CLOSED', 'RESULT_PENDING', 'PUBLISHED', 'CANCELLED', 'ADMISSION_OPEN', 'SUSPENDED', 'CLOSING', 'SCORING') NOT NULL DEFAULT 'DRAFT',
    `paperStatus` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `term` VARCHAR(191) NOT NULL DEFAULT '2026-SPRING',
    `paperSubmittedBy` CHAR(36) NULL,
    `paperApprovedBy` CHAR(36) NULL,
    `paperApprovedAt` DATETIME(3) NULL,
    `paperReviewNote` TEXT NULL,
    `opensAt` DATETIME(3) NOT NULL,
    `closesAt` DATETIME(3) NOT NULL,
    `durationMin` INTEGER NOT NULL,
    `totalMarks` DOUBLE NOT NULL DEFAULT 0,
    `passPercent` DOUBLE NOT NULL DEFAULT 50,
    `negativeMarking` DOUBLE NOT NULL DEFAULT 0,
    `shuffleQuestions` BOOLEAN NOT NULL DEFAULT true,
    `instructions` TEXT NULL,
    `timingPolicy` ENUM('INDIVIDUAL', 'SYNCHRONIZED') NOT NULL DEFAULT 'INDIVIDUAL',
    `controlMode` ENUM('AUTOMATIC', 'MANUAL') NOT NULL DEFAULT 'AUTOMATIC',
    `suspendTimePolicy` ENUM('FREEZE_CLOCK', 'CLOCK_CONTINUES') NULL,
    `controlPolicyApprovedBy` CHAR(36) NULL,
    `controlPolicyApprovedAt` DATETIME(3) NULL,
    `officialStartAt` DATETIME(3) NULL,
    `admissionOpenedAt` DATETIME(3) NULL,
    `admissionClosedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `forceCloseAt` DATETIME(3) NULL,
    `stateVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `exams_code_key`(`code`),
    INDEX `exams_status_opensAt_idx`(`status`, `opensAt`),
    INDEX `exams_status_closesAt_idx`(`status`, `closesAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_institutions` (
    `examId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `venue` VARCHAR(191) NULL,

    INDEX `exam_institutions_institutionId_idx`(`institutionId`),
    PRIMARY KEY (`examId`, `institutionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_questions` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `questionId` CHAR(36) NOT NULL,
    `position` INTEGER NOT NULL,
    `marks` DOUBLE NOT NULL DEFAULT 1,
    `snapshot` JSON NULL,
    `correctLabel` VARCHAR(191) NULL,

    UNIQUE INDEX `exam_questions_examId_questionId_key`(`examId`, `questionId`),
    UNIQUE INDEX `exam_questions_examId_position_key`(`examId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_candidates` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `studentId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `extraTimeMin` INTEGER NOT NULL DEFAULT 0,
    `accommodation` TEXT NULL,
    `status` ENUM('ADMITTED', 'REVOKED') NOT NULL DEFAULT 'ADMITTED',
    `decisionSource` VARCHAR(191) NOT NULL DEFAULT 'ENROLMENT',
    `statusReason` TEXT NULL,
    `statusChangedAt` DATETIME(3) NULL,
    `rosterVersion` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `exam_candidates_institutionId_examId_idx`(`institutionId`, `examId`),
    INDEX `exam_candidates_examId_institutionId_idx`(`examId`, `institutionId`),
    UNIQUE INDEX `exam_candidates_examId_studentId_key`(`examId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_invigilators` (
    `examId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,

    INDEX `exam_invigilators_userId_idx`(`userId`),
    PRIMARY KEY (`examId`, `userId`, `institutionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attempts` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `studentId` CHAR(36) NOT NULL,
    `status` ENUM('IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'VOID') NOT NULL DEFAULT 'IN_PROGRESS',
    `startedAt` DATETIME(3) NOT NULL,
    `deadlineAt` DATETIME(3) NOT NULL,
    `extraTimeMin` INTEGER NOT NULL DEFAULT 0,
    `submittedAt` DATETIME(3) NULL,
    `submitKey` VARCHAR(191) NULL,
    `receiptCode` VARCHAR(191) NULL,
    `answerDigest` VARCHAR(191) NULL,
    `questionOrder` JSON NOT NULL,
    `activeClientId` VARCHAR(191) NULL,
    `clientEpoch` INTEGER NOT NULL DEFAULT 0,
    `lastHeartbeatAt` DATETIME(3) NULL,
    `integrityFlags` INTEGER NOT NULL DEFAULT 0,
    `admission` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `suspendedAt` DATETIME(3) NULL,
    `suspensionId` CHAR(36) NULL,
    `lifecycleRetries` INTEGER NOT NULL DEFAULT 0,
    `lifecycleError` TEXT NULL,

    UNIQUE INDEX `attempts_receiptCode_key`(`receiptCode`),
    INDEX `attempts_examId_status_idx`(`examId`, `status`),
    INDEX `attempts_status_deadlineAt_idx`(`status`, `deadlineAt`),
    INDEX `attempts_examId_suspensionId_idx`(`examId`, `suspensionId`),
    UNIQUE INDEX `attempts_examId_studentId_key`(`examId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attempt_answers` (
    `attemptId` CHAR(36) NOT NULL,
    `examQuestionId` CHAR(36) NOT NULL,
    `selectedLabel` VARCHAR(191) NULL,
    `state` ENUM('ANSWERED', 'SKIPPED', 'CLEARED') NOT NULL DEFAULT 'SKIPPED',
    `markedForReview` BOOLEAN NOT NULL DEFAULT false,
    `visited` BOOLEAN NOT NULL DEFAULT true,
    `revision` INTEGER NOT NULL,
    `savedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`attemptId`, `examQuestionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `answer_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `attemptId` CHAR(36) NOT NULL,
    `examQuestionId` CHAR(36) NOT NULL,
    `revision` INTEGER NOT NULL,
    `selectedLabel` VARCHAR(191) NULL,
    `state` ENUM('ANSWERED', 'SKIPPED', 'CLEARED') NOT NULL,
    `markedForReview` BOOLEAN NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `answer_events_attemptId_examQuestionId_revision_idx`(`attemptId`, `examQuestionId`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attempt_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `attemptId` CHAR(36) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `detail` JSON NULL,
    `actorId` CHAR(36) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attempt_events_attemptId_at_idx`(`attemptId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incidents` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `attemptId` CHAR(36) NULL,
    `studentId` CHAR(36) NULL,
    `type` ENUM('CONNECTIVITY', 'TECHNICAL', 'IDENTITY', 'MISCONDUCT', 'ENVIRONMENT', 'OTHER') NOT NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'LOW',
    `description` TEXT NOT NULL,
    `status` ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `resolution` TEXT NULL,
    `reportedBy` CHAR(36) NOT NULL,
    `resolvedBy` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `incidents_examId_status_idx`(`examId`, `status`),
    INDEX `incidents_institutionId_status_idx`(`institutionId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `incident_notes` (
    `id` CHAR(36) NOT NULL,
    `incidentId` CHAR(36) NOT NULL,
    `authorId` CHAR(36) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `key_actions` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `examQuestionId` CHAR(36) NOT NULL,
    `kind` ENUM('VOID', 'CHANGE_KEY') NOT NULL,
    `newLabel` VARCHAR(191) NULL,
    `reason` TEXT NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `key_actions_examId_idx`(`examId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `result_batches` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `status` ENUM('GRADED', 'LECTURER_REVIEWED', 'EXAMINER_APPROVED', 'PUBLISHED') NOT NULL DEFAULT 'GRADED',
    `gradedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedBy` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `examinerApprovedBy` CHAR(36) NULL,
    `examinerApprovedAt` DATETIME(3) NULL,
    `publishedBy` CHAR(36) NULL,
    `publishedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,

    UNIQUE INDEX `result_batches_examId_key`(`examId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `results` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `studentId` CHAR(36) NOT NULL,
    `attemptId` CHAR(36) NULL,
    `rawScore` DOUBLE NOT NULL,
    `adjustment` DOUBLE NOT NULL DEFAULT 0,
    `totalMarks` DOUBLE NOT NULL,
    `percent` DOUBLE NOT NULL,
    `status` ENUM('PASS', 'FAIL', 'ABSENT', 'WITHHELD') NOT NULL,
    `gradedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `results_studentId_idx`(`studentId`),
    UNIQUE INDEX `results_examId_studentId_key`(`examId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certificates` (
    `id` CHAR(36) NOT NULL,
    `resultId` CHAR(36) NOT NULL,
    `serial` VARCHAR(191) NOT NULL,
    `verifyCode` VARCHAR(191) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `issuedBy` CHAR(36) NOT NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `certificates_resultId_key`(`resultId`),
    UNIQUE INDEX `certificates_serial_key`(`serial`),
    UNIQUE INDEX `certificates_verifyCode_key`(`verifyCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `title` TEXT NOT NULL,
    `body` TEXT NOT NULL,
    `link` TEXT NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_readAt_createdAt_idx`(`userId`, `readAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbound_messages` (
    `id` CHAR(36) NOT NULL,
    `toEmail` VARCHAR(191) NOT NULL,
    `subject` TEXT NOT NULL,
    `body` TEXT NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    INDEX `outbound_messages_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `seq` BIGINT NOT NULL AUTO_INCREMENT,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorId` CHAR(36) NULL,
    `actorRole` ENUM('STUDENT', 'LECTURER', 'EXAMINER', 'CAMPUS_ADMIN', 'INVIGILATOR', 'CCE', 'SUPER_ADMIN') NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `institutionId` CHAR(36) NULL,
    `meta` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `prevHash` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,

    INDEX `audit_logs_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `audit_logs_institutionId_at_idx`(`institutionId`, `at`),
    INDEX `audit_logs_actorId_at_idx`(`actorId`, `at`),
    PRIMARY KEY (`seq`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_roster_versions` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `createdById` CHAR(36) NOT NULL,
    `approvedById` CHAR(36) NOT NULL,
    `candidateCount` INTEGER NOT NULL,
    `revokedCount` INTEGER NOT NULL,
    `digest` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `exam_roster_versions_examId_version_key`(`examId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `eligibility_overrides` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `studentId` CHAR(36) NOT NULL,
    `attemptId` CHAR(36) NULL,
    `oldDecision` VARCHAR(191) NOT NULL,
    `newDecision` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `approvedById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `eligibility_overrides_examId_studentId_idx`(`examId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_assignments` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NOT NULL,
    `assignedById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `revokedById` CHAR(36) NULL,

    INDEX `course_assignments_userId_revokedAt_idx`(`userId`, `revokedAt`),
    INDEX `course_assignments_courseId_institutionId_idx`(`courseId`, `institutionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mfa_recovery_codes` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `mfa_recovery_codes_userId_codeHash_key`(`userId`, `codeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_suspensions` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `scope` ENUM('EXAM', 'CAMPUS', 'CANDIDATES') NOT NULL,
    `institutionId` CHAR(36) NULL,
    `studentIds` JSON NOT NULL,
    `reason` TEXT NOT NULL,
    `incidentId` CHAR(36) NULL,
    `timePolicy` ENUM('FREEZE_CLOCK', 'CLOCK_CONTINUES') NOT NULL,
    `suspendedBy` CHAR(36) NOT NULL,
    `suspendedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `affectedCount` INTEGER NOT NULL DEFAULT 0,
    `resumedBy` CHAR(36) NULL,
    `resumedAt` DATETIME(3) NULL,
    `resumeNote` TEXT NULL,
    `pausedSeconds` INTEGER NULL,

    INDEX `exam_suspensions_examId_resumedAt_idx`(`examId`, `resumedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_extensions` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `scope` ENUM('CANDIDATES', 'CAMPUS', 'EXAM') NOT NULL,
    `institutionId` CHAR(36) NULL,
    `studentIds` JSON NOT NULL,
    `minutes` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `approvedBy` CHAR(36) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `affectedCount` INTEGER NOT NULL,
    `closesAtBefore` DATETIME(3) NULL,
    `closesAtAfter` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `exam_extensions_examId_idempotencyKey_key`(`examId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_commands` (
    `id` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `command` VARCHAR(191) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `result` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `exam_commands_examId_idempotencyKey_key`(`examId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `eventId` CHAR(36) NOT NULL,
    `examId` CHAR(36) NOT NULL,
    `institutionId` CHAR(36) NULL,
    `studentId` CHAR(36) NULL,
    `aggregateVersion` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deliveryStatus` ENUM('PENDING', 'DELIVERED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `deliveredAt` DATETIME(3) NULL,

    UNIQUE INDEX `exam_events_eventId_key`(`eventId`),
    INDEX `exam_events_examId_id_idx`(`examId`, `id`),
    INDEX `exam_events_deliveryStatus_id_idx`(`deliveryStatus`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lifecycle_leases` (
    `name` VARCHAR(191) NOT NULL,
    `owner` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_locks` (
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lifecycle_runs` (
    `id` CHAR(36) NOT NULL,
    `instance` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `durationMs` INTEGER NULL,
    `stats` JSON NOT NULL,
    `error` TEXT NULL,

    INDEX `lifecycle_runs_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courses` ADD CONSTRAINT `courses_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_institutions` ADD CONSTRAINT `user_institutions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_institutions` ADD CONSTRAINT `user_institutions_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_resets` ADD CONSTRAINT `password_resets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_history` ADD CONSTRAINT `password_history_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roster_entries` ADD CONSTRAINT `roster_entries_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roster_entries` ADD CONSTRAINT `roster_entries_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_options` ADD CONSTRAINT `question_options_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `questions`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `exams` ADD CONSTRAINT `exams_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_institutions` ADD CONSTRAINT `exam_institutions_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_institutions` ADD CONSTRAINT `exam_institutions_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_questions` ADD CONSTRAINT `exam_questions_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_questions` ADD CONSTRAINT `exam_questions_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `questions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_candidates` ADD CONSTRAINT `exam_candidates_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_candidates` ADD CONSTRAINT `exam_candidates_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_candidates` ADD CONSTRAINT `exam_candidates_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_invigilators` ADD CONSTRAINT `exam_invigilators_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempts` ADD CONSTRAINT `attempts_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempts` ADD CONSTRAINT `attempts_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempt_answers` ADD CONSTRAINT `attempt_answers_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempt_answers` ADD CONSTRAINT `attempt_answers_examQuestionId_fkey` FOREIGN KEY (`examQuestionId`) REFERENCES `exam_questions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempt_events` ADD CONSTRAINT `attempt_events_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `attempts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incident_notes` ADD CONSTRAINT `incident_notes_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `key_actions` ADD CONSTRAINT `key_actions_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `key_actions` ADD CONSTRAINT `key_actions_examQuestionId_fkey` FOREIGN KEY (`examQuestionId`) REFERENCES `exam_questions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `result_batches` ADD CONSTRAINT `result_batches_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `results` ADD CONSTRAINT `results_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `results` ADD CONSTRAINT `results_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_resultId_fkey` FOREIGN KEY (`resultId`) REFERENCES `results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_roster_versions` ADD CONSTRAINT `exam_roster_versions_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `eligibility_overrides` ADD CONSTRAINT `eligibility_overrides_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `eligibility_overrides` ADD CONSTRAINT `eligibility_overrides_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `eligibility_overrides` ADD CONSTRAINT `eligibility_overrides_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `attempts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_assignments` ADD CONSTRAINT `course_assignments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `course_assignments` ADD CONSTRAINT `course_assignments_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `course_assignments` ADD CONSTRAINT `course_assignments_institutionId_fkey` FOREIGN KEY (`institutionId`) REFERENCES `institutions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `mfa_recovery_codes` ADD CONSTRAINT `mfa_recovery_codes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_suspensions` ADD CONSTRAINT `exam_suspensions_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_extensions` ADD CONSTRAINT `exam_extensions_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_commands` ADD CONSTRAINT `exam_commands_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_events` ADD CONSTRAINT `exam_events_examId_fkey` FOREIGN KEY (`examId`) REFERENCES `exams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════════════════════ hand-written additions (integrity guarantees enforced by the database itself) ═════════════════════════
-- Ported from the PostgreSQL migrations (archived in prisma/migrations-postgres-archive). MySQL has no partial indexes, plpgsql or
-- transaction-scoped advisory locks, so the equivalents are: stored generated columns + UNIQUE, BEGIN…END triggers with SIGNAL,
-- and row locks on `app_locks`. SQLSTATE 45000 is MySQL's "unhandled user-defined exception".

-- JSON defaults (Prisma does not emit DB-level defaults for JSON columns on MySQL; raw INSERTs rely on them).
ALTER TABLE `exam_events` MODIFY `payload` JSON NOT NULL DEFAULT ('{}');
ALTER TABLE `lifecycle_runs` MODIFY `stats` JSON NOT NULL DEFAULT ('{}');
ALTER TABLE `questions` MODIFY `tags` JSON NOT NULL DEFAULT ('[]');
ALTER TABLE `exam_suspensions` MODIFY `studentIds` JSON NOT NULL DEFAULT ('[]');
ALTER TABLE `exam_extensions` MODIFY `studentIds` JSON NOT NULL DEFAULT ('[]');

-- Audit log, answer journal, roster versions and eligibility overrides are append-only evidence.
CREATE TRIGGER `audit_logs_no_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
CREATE TRIGGER `audit_logs_no_delete` BEFORE DELETE ON `audit_logs` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
CREATE TRIGGER `answer_events_no_update` BEFORE UPDATE ON `answer_events` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'answer_events is append-only';
CREATE TRIGGER `answer_events_no_delete` BEFORE DELETE ON `answer_events` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'answer_events is append-only';
CREATE TRIGGER `exam_roster_versions_no_update` BEFORE UPDATE ON `exam_roster_versions` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'exam_roster_versions is append-only';
CREATE TRIGGER `exam_roster_versions_no_delete` BEFORE DELETE ON `exam_roster_versions` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'exam_roster_versions is append-only';
CREATE TRIGGER `eligibility_overrides_no_update` BEFORE UPDATE ON `eligibility_overrides` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'eligibility_overrides is append-only';
CREATE TRIGGER `eligibility_overrides_no_delete` BEFORE DELETE ON `eligibility_overrides` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'eligibility_overrides is append-only';

-- A submitted attempt's answers can never change again (defence in depth behind the API).
CREATE TRIGGER `attempt_answers_lock_ins` BEFORE INSERT ON `attempt_answers` FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `attempts` WHERE `id` = NEW.`attemptId`) <> 'IN_PROGRESS' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attempt is finalised; answers are immutable';
  END IF;
END;
CREATE TRIGGER `attempt_answers_lock_upd` BEFORE UPDATE ON `attempt_answers` FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `attempts` WHERE `id` = OLD.`attemptId`) <> 'IN_PROGRESS' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attempt is finalised; answers are immutable';
  END IF;
END;
CREATE TRIGGER `attempt_answers_lock_del` BEFORE DELETE ON `attempt_answers` FOR EACH ROW
BEGIN
  IF (SELECT `status` FROM `attempts` WHERE `id` = OLD.`attemptId`) <> 'IN_PROGRESS' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'attempt is finalised; answers are immutable';
  END IF;
END;

-- exam_events is an append-only transition log: rows are never deleted and only the delivery bookkeeping may change.
CREATE TRIGGER `exam_events_no_delete` BEFORE DELETE ON `exam_events` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'exam_events is append-only';
CREATE TRIGGER `exam_events_guard` BEFORE UPDATE ON `exam_events` FOR EACH ROW
BEGIN
  IF NOT (NEW.`id` <=> OLD.`id` AND NEW.`eventId` <=> OLD.`eventId` AND NEW.`examId` <=> OLD.`examId`
          AND NEW.`institutionId` <=> OLD.`institutionId` AND NEW.`studentId` <=> OLD.`studentId`
          AND NEW.`aggregateVersion` <=> OLD.`aggregateVersion` AND BINARY NEW.`type` <=> BINARY OLD.`type`
          AND BINARY NEW.`payload` <=> BINARY OLD.`payload` AND NEW.`createdAt` <=> OLD.`createdAt`) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'exam_events: only delivery fields may be updated';
  END IF;
END;

-- Row-level invariants.
ALTER TABLE `attempt_answers` ADD CONSTRAINT `attempt_answers_revision_nonneg` CHECK (`revision` >= 0);
ALTER TABLE `attempt_answers` ADD CONSTRAINT `attempt_answers_state_consistent` CHECK (
  (`state` = 'ANSWERED' AND `selectedLabel` IS NOT NULL) OR (`state` <> 'ANSWERED' AND `selectedLabel` IS NULL));
ALTER TABLE `attempts` ADD CONSTRAINT `attempts_deadline_after_start` CHECK (`deadlineAt` > `startedAt`);
ALTER TABLE `attempts` ADD CONSTRAINT `attempts_submitted_has_receipt` CHECK (
  `status` = 'IN_PROGRESS' OR `status` = 'VOID' OR (`submittedAt` IS NOT NULL AND `receiptCode` IS NOT NULL));
ALTER TABLE `exams` ADD CONSTRAINT `exams_window_valid` CHECK (`closesAt` > `opensAt`);
ALTER TABLE `exams` ADD CONSTRAINT `exams_duration_valid` CHECK (`durationMin` BETWEEN 5 AND 480);
ALTER TABLE `exams` ADD CONSTRAINT `exams_pass_valid` CHECK (`passPercent` BETWEEN 0 AND 100);
ALTER TABLE `exams` ADD CONSTRAINT `exams_neg_valid` CHECK (`negativeMarking` BETWEEN 0 AND 1);
ALTER TABLE `exam_questions` ADD CONSTRAINT `exam_questions_marks_pos` CHECK (`marks` > 0);
ALTER TABLE `question_options` ADD CONSTRAINT `question_options_label` CHECK (BINARY `label` IN ('A', 'B', 'C', 'D', 'E'));
-- Emails are stored lower-case (the column collation is case-insensitive, so compare bytes).
ALTER TABLE `users` ADD CONSTRAINT `users_email_lower` CHECK (BINARY `email` = BINARY LOWER(`email`));
ALTER TABLE `eligibility_overrides` ADD CONSTRAINT `eligibility_overrides_decisions_chk`
  CHECK (CHAR_LENGTH(TRIM(`reason`)) >= 10 AND `oldDecision` <> `newDecision`);
ALTER TABLE `exam_extensions` ADD CONSTRAINT `exam_extensions_minutes_chk` CHECK (`minutes` BETWEEN 1 AND 240);
ALTER TABLE `exam_suspensions` ADD CONSTRAINT `exam_suspensions_scope_chk` CHECK (
  (`scope` = 'EXAM') OR (`scope` = 'CAMPUS' AND `institutionId` IS NOT NULL)
  OR (`scope` = 'CANDIDATES' AND JSON_LENGTH(`studentIds`) > 0));

-- Partial unique indexes → a virtual generated column that is NULL outside the predicate (NULLs never collide in a UNIQUE index).
-- At most one correct option per question (single-best-answer format).
ALTER TABLE `question_options` ADD COLUMN `correctFlag` TINYINT AS (IF(`isCorrect`, 1, NULL)) VIRTUAL;
CREATE UNIQUE INDEX `question_options_one_correct` ON `question_options` (`questionId`, `correctFlag`);
-- At most one ACTIVE (non-revoked) assignment per lecturer/course/campus.
ALTER TABLE `course_assignments` ADD COLUMN `activeKey` TINYINT AS (IF(`revokedAt` IS NULL, 1, NULL)) VIRTUAL;
CREATE UNIQUE INDEX `course_assignments_active_uniq` ON `course_assignments` (`userId`, `courseId`, `institutionId`, `activeKey`);

-- Locks taken with SELECT … FOR UPDATE inside a transaction (replace pg_advisory_xact_lock).
INSERT INTO `app_locks` (`name`) VALUES ('audit_chain');

-- Certificate serial numbers (MariaDB sequence; continues from the PostgreSQL sequence start).
CREATE SEQUENCE `certificate_serial_seq` START WITH 1000;
