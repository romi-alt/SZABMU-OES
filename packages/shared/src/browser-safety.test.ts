import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The package barrel (index.ts) is imported by the browser bundle. Nothing it re-exports may import a Node built-in:
 * that makes the bundler ship polyfills (a ~450 KB crypto-browserify copy before this guard existed) and triggers CSP `eval` reports.
 * Server-only code belongs in server.ts, imported as '@oes/shared/server' by the API.
 */
describe('browser-safe barrel', () => {
  const dir = __dirname;
  const index = readFileSync(path.join(dir, 'index.ts'), 'utf8');
  const files = [...index.matchAll(/export \* from '\.\/([\w-]+)'/g)].map((m) => m[1]!);
  it('re-exports at least the known modules', () => { expect(files).toEqual(expect.arrayContaining(['roles', 'permissions', 'exam-rules', 'password', 'constants'])); });
  for (const f of files) {
    it(`${f}.ts imports no Node built-in`, () => {
      const src = readFileSync(path.join(dir, `${f}.ts`), 'utf8');
      expect(src).not.toMatch(/from\s+['"](node:[^'"]+|crypto|fs|path|os|util|stream|buffer|child_process)['"]/);
      expect(src).not.toMatch(/require\(\s*['"](node:[^'"]+|crypto|fs|path|os|util)['"]\s*\)/);
    });
  }
  it('the barrel does not export the server module', () => { expect(index).not.toMatch(/\.\/server/); });
});
