import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

// Browser tests run against the real stack: Next.js (production build) → NestJS API → PostgreSQL + Redis,
// seeded with synthetic data by tests/e2e/global-setup.ts.
const chromiumPath = process.env.CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { ...(chromiumPath ? { executablePath: chromiumPath } : {}), args: ['--no-sandbox'] } },
  webServer: [
    { command: 'node --env-file=.env apps/api/dist/main.js', url: 'http://localhost:4000/api/health', reuseExistingServer: true, timeout: 60_000, env: { RUN_WORKERS: 'true' } },
    // NODE_ENV=production so the production Content-Security-Policy (no 'unsafe-eval') is what the browser tests exercise
    { command: 'npm run start -w @oes/web', url: 'http://localhost:3000/login', reuseExistingServer: true, timeout: 60_000, env: { NODE_ENV: 'production' } },
  ],
});
