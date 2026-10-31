import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// Fault-injection suite: spawns real API processes and a DISPOSABLE PostgreSQL + Redis (see test-fault/harness.ts).
// Deliberately NOT part of `npm test`: it builds the API, runs initdb, and kills processes.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true }, target: 'es2022' } })],
  test: { include: ['test-fault/**/*.test.ts'], fileParallelism: false, testTimeout: 180_000, hookTimeout: 300_000, pool: 'forks' },
});
