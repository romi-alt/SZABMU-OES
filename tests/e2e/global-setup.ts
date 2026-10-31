import { execSync } from 'node:child_process';

export default async function globalSetup() {
  // Re-seed the DEVELOPMENT database with synthetic data (the seeder refuses to run in production).
  execSync('node --env-file=.env apps/api/dist/seed/seed.js --reset', { stdio: 'inherit', env: { ...process.env, RUN_WORKERS: 'false' } });
  execSync('redis-cli -p 6390 flushall', { stdio: 'ignore' });
}
