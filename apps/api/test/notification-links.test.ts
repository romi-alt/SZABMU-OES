import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LINKS, isSafeAppLink } from '@oes/shared';
import { routeExists, webRoutes } from './web-routes';

describe('notification links', () => {
  it('the web route table is derived from real pages', () => {
    const r = webRoutes();
    expect(r).toEqual(expect.arrayContaining(['/schedule', '/results', '/incidents', '/questions', '/monitor', '/exams', '/exams/:id']));
    expect(routeExists('/exams/7f1d0b9e-0000-4000-8000-000000000001', r)).toBe(true);
    expect(routeExists('/student/schedule', r)).toBe(false);          // the pre-fix, non-existent destination
    expect(routeExists('/cce/incidents', r)).toBe(false);
  });

  it('every destination the API can store resolves to an existing page', () => {
    const all = Object.values(LINKS).map((v) => (typeof v === 'function' ? v('7f1d0b9e-0000-4000-8000-000000000001') : v));
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const l of all) { expect(isSafeAppLink(l), l).toBe(true); expect(routeExists(l), `${l} has no page`).toBe(true); }
  });

  it('no notification call site passes a hand-written path (all go through LINKS)', () => {
    const root = path.resolve(__dirname, '../src/modules'); const bad: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const f = path.join(d, n); if (statSync(f).isDirectory()) walk(f); else if (f.endsWith('.ts')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/notifications\.(notify|notifyRole)\(([^;]*)\);/g)) if (/['"`]\/[a-z]/.test(m[2]!)) bad.push(`${path.relative(root, f)}: ${m[0].slice(0, 90)}`);
    } } };
    walk(root); expect(bad).toEqual([]);
  });

  it('staff-role notifications never link to the candidate-only /results page', () => {
    const root = path.resolve(__dirname, '../src/modules'); const bad: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const f = path.join(d, n); if (statSync(f).isDirectory()) walk(f); else if (f.endsWith('.ts')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/notifications\.notifyRole\(([^;]*)\);/g)) if (/LINKS\.results\b/.test(m[1]!)) bad.push(`${path.relative(root, f)}: ${m[0].slice(0, 90)}`);
    } } };
    walk(root); expect(bad).toEqual([]);
  });

  it('the client only follows plain same-origin paths', () => {
    for (const ok of ['/schedule', '/exams/abc-123', '/results']) expect(isSafeAppLink(ok)).toBe(true);
    for (const bad of ['//evil.example/x', 'https://evil.example', 'javascript:alert(1)', '/a b', '/x?y=<script>', '', null, undefined, 42]) expect(isSafeAppLink(bad), String(bad)).toBe(false);
  });
});
