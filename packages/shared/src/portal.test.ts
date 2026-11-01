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
    for (const p of ['/schedule', '/results', '/performance', '/exam/abc', '/certificate/1']) {
      expect(isPagePathAllowedOnPortal(p, 'student')).toBe(true); expect(isPagePathAllowedOnPortal(p, 'staff')).toBe(false);
    }
    for (const p of ['/questions', '/exams', '/exams/abc/control', '/students', '/enrolment', '/assignments', '/users', '/institutions', '/programs', '/monitor/x', '/incidents', '/audit']) {
      expect(isPagePathAllowedOnPortal(p, 'staff')).toBe(true); expect(isPagePathAllowedOnPortal(p, 'student')).toBe(false);
    }
  });

  it('serves sign-in, recovery, verification, dashboard and profile on both', () => {
    for (const p of ['/', '/login', '/forgot', '/verify', '/mfa', '/dashboard', '/profile'])
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
