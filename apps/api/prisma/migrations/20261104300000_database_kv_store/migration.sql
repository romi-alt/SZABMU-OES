-- CreateTable
CREATE TABLE `kv_entries` (
    `k` VARCHAR(191) NOT NULL,
    `grp` VARCHAR(191) NULL,
    `v` LONGTEXT NULL,
    `n` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `kv_entries_grp_idx`(`grp`),
    INDEX `kv_entries_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`k`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attempt_heartbeats` (
    `attemptId` VARCHAR(191) NOT NULL,
    `examId` VARCHAR(191) NOT NULL,
    `institutionId` VARCHAR(191) NOT NULL,
    `t` BIGINT NOT NULL,
    `online` BOOLEAN NOT NULL,

    INDEX `attempt_heartbeats_examId_institutionId_t_idx`(`examId`, `institutionId`, `t`),
    INDEX `attempt_heartbeats_t_idx`(`t`),
    PRIMARY KEY (`attemptId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

