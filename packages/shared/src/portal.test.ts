import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLES } from './roles';
import { isPagePathAllowedOnPortal, portalForRole, portalOf, roleAllowedOnPortal } from './portal';

describe('portal binding', () => {
  it('maps STUDENT to the student portal and every other role to the staff portal, exclusively', () => {
    for (const r of ROLES) {
      const expected = r === 'STUDENT' ? 'student' : 'staff';
      expect(portalForRole(r)).toBe(expected);
      expect(roleAllowedOnPortal(r, 'student')).toBe(r === 'STUDENT');
      expect(roleAllowedOnPortal(r, 'staff')).toBe(r !== 'STUDENT');
    }
  });

  it('accepts only the two known header values', () => {
    expect(portalOf('student')).toBe('student'); expect(portalOf('staff')).toBe('staff');
    for (const bad of [undefined, null, '', 'Student', 'STAFF', 'admin', ['staff'], 1]) expect(portalOf(bad)).toBeNull();
  });
});

describe('page routes per portal', () => {
  it('serves candidate pages only on the student portal and staff pages only on the staff portal', () => {
    for (const p of ['/schedule', '/results', '/performance', '/exam/abc', '/certificate/1', '/register']) {
      expect(isPagePathAllowedOnPortal(p, 'student')).toBe(true); expect(isPagePathAllowedOnPortal(p, 'staff')).toBe(false);
    }
    for (const p of ['/questions', '/exams', '/exams/abc/control', '/students', '/enrolment', '/roster', '/assignments', '/users', '/institutions', '/programs', '/monitor/x', '/incidents', '/audit']) {
      expect(isPagePathAllowedOnPortal(p, 'staff')).toBe(true); expect(isPagePathAllowedOnPortal(p, 'student')).toBe(false);
    }
  });

  it('serves sign-in, recovery, verification, dashboard and profile on both', () => {
    for (const p of ['/', '/login', '/forgot', '/verify', '/mfa', '/dashboard', '/profile', '/help'])
      for (const portal of ['student', 'staff'] as const) expect(isPagePathAllowedOnPortal(p, portal)).toBe(true);
  });

  it('matches whole segments: /exam is not /exams, case and query are normalised, unknown pages are refused', () => {
    expect(isPagePathAllowedOnPortal('/exams', 'student')).toBe(false);
    expect(isPagePathAllowedOnPortal('/exam', 'staff')).toBe(false);
    expect(isPagePathAllowedOnPortal('/Exams/1?x=1', 'staff')).toBe(true);
    expect(isPagePathAllowedOnPortal('/admin', 'staff')).toBe(false);
    expect(isPagePathAllowedOnPortal('//schedule', 'student')).toBe(true);
  });
});

describe('every page of the web app belongs to a portal', () => {
  const APP = join(__dirname, '../../../apps/web/src/app');
  /** First path segment of every route that has a page.tsx (route groups like "(app)" do not count as segments). */
  const routes = (dir: string, depth = 0): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (!e.isDirectory() || e.name.startsWith('_')) return [];
    const sub = join(dir, e.name); const group = e.name.startsWith('(') && e.name.endsWith(')');
    const own = existsSync(join(sub, 'page.tsx')) && !group ? [e.name.replace(/^\[.*\]$/, '')] : [];
    return group ? routes(sub, depth) : [...own, ...(depth === 0 && !own.length ? [] : [])];
  });
  const found = new Set([...routes(APP), ...readdirSync(APP, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('(')).flatMap((g) => routes(join(APP, g.name)))]);
  it('serves the teacher question-bank screens on the staff portal only (they 404ed on the live staff site)', () => {
    for (const p of ['/question-banks', '/submissions', '/question-banks/abc']) { expect(isPagePathAllowedOnPortal(p, 'staff'), p).toBe(true); expect(isPagePathAllowedOnPortal(p, 'student'), p).toBe(false); }
  });
  it('has no page route that neither portal serves (a new page must be added to portal.ts)', () => {
    expect(found.size).toBeGreaterThan(15);
    const unserved = [...found].filter((r) => !isPagePathAllowedOnPortal(`/${r}`, 'staff') && !isPagePathAllowedOnPortal(`/${r}`, 'student'));
    expect(unserved).toEqual([]);
  });
});
