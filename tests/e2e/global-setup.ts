import { execSync } from 'node:child_process';

export default async function globalSetup() {
  // 8 students per campus (the seed default for API tests is 6): every spec that changes a candidate's state owns a candidate nobody else uses,
  // so the suite does not depend on execution order. Candidates are student.a002..a008 and student.b002..b008.
  // Re-seed the DEVELOPMENT database with synthetic data (the seeder refuses to run in production).
  execSync('node --env-file=.env apps/api/dist/seed/seed.js --reset', { stdio: 'inherit', env: { ...process.env, RUN_WORKERS: 'false', SEED_STUDENTS_PER_CAMPUS: process.env.SEED_STUDENTS_PER_CAMPUS ?? '8' } });
  execSync('redis-cli -p 6390 flushall', { stdio: 'ignore' });
}
