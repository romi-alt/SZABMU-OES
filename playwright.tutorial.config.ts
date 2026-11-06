import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Records the student walkthrough video against the disposable local stack (never the live site). See tests/tutorial/README.md.
export default defineConfig({
  ...base,
  testDir: 'tests/tutorial',
  timeout: 600_000,
  outputDir: process.env.TUTORIAL_OUT ?? 'test-results-tutorial',
  use: { ...base.use, viewport: { width: 1280, height: 720 }, bypassCSP: true, actionTimeout: 20_000, video: { mode: 'on', size: { width: 1280, height: 720 } }, screenshot: 'off', trace: 'off' },
});
