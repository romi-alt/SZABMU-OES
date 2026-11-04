-- Local dev only: a separate database for the integration tests, and the rights `prisma migrate` needs.
CREATE DATABASE IF NOT EXISTS szabmu_oes_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON *.* TO 'oes'@'%';
