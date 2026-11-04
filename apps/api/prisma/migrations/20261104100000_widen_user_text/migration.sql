-- Inputs are validated up to 254 characters (email, RFC 5321) and 200 (names/titles); Prisma's MySQL default VARCHAR(191) is shorter,
-- and the session runs in STRICT_TRANS_TABLES, so a long but valid value would be rejected. Widen to what the API accepts.
ALTER TABLE `users` MODIFY `email` VARCHAR(254) NOT NULL, MODIFY `fullName` VARCHAR(255) NOT NULL;
ALTER TABLE `roster_entries` MODIFY `fullName` VARCHAR(255) NOT NULL;
ALTER TABLE `outbound_messages` MODIFY `toEmail` VARCHAR(254) NOT NULL;
ALTER TABLE `institutions` MODIFY `name` VARCHAR(255) NOT NULL;
ALTER TABLE `departments` MODIFY `name` VARCHAR(255) NOT NULL;
ALTER TABLE `programs` MODIFY `name` VARCHAR(255) NOT NULL;
ALTER TABLE `courses` MODIFY `title` VARCHAR(255) NOT NULL;
ALTER TABLE `exams` MODIFY `title` VARCHAR(255) NOT NULL;
