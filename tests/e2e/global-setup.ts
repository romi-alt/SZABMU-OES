import { execSync } from 'node:child_process';

export default async function globalSetup() {
  // 9 students per campus (the seed default for API tests is 6): every spec that changes a candidate's state owns a candidate nobody else uses,
  // so the suite does not depend on execution order. Candidates are student.a002..a009 and student.b002..b009 (a009: accessibility scans of the exam player).
  // Re-seed the DEVELOPMENT database with synthetic data (the seeder refuses to run in production).
  execSync('node --env-file=.env apps/api/dist/seed/seed.js --reset', { stdio: 'inherit', env: { ...process.env, RUN_WORKERS: 'false', SEED_STUDENTS_PER_CAMPUS: process.env.SEED_STUDENTS_PER_CAMPUS ?? '9' } });
  // The real institution/programme directory, applied over the demo universe exactly as the operator would (the browser tests run on a demo-visible site).
  execSync('node --env-file=.env apps/api/dist/directory/cli.js import --apply --actor e2e-setup', { stdio: 'inherit', env: { ...process.env, RUN_WORKERS: 'false' } });
  execSync('redis-cli -p 6390 flushall', { stdio: 'ignore' });
}
