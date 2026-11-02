import type { Role } from './roles';

/**
 * Two public portals of ONE platform (same API, same database, same exam engine):
 *   student → https://oes.szabmu.site        candidates only
 *   staff   → https://dashboard.szabmu.site  every other role
 *
 * The reverse proxy tells the API which portal a request arrived on with the `X-OES-Portal` header (it overwrites whatever the
 * client sent, and the API is only reachable through it). Cookies are host-only, so a session never crosses subdomains in the
 * browser; the rules below make the SERVER refuse a role on the wrong portal as well, on every request, not only at sign-in.
 */
export const PORTALS = ['student', 'staff'] as const;
export type Portal = (typeof PORTALS)[number];
export const PORTAL_HEADER = 'x-oes-portal';

export const portalOf = (v: unknown): Portal | null => (typeof v === 'string' && (PORTALS as readonly string[]).includes(v) ? (v as Portal) : null);

/** Candidates belong to the student portal; every other role to the staff portal. */
export const portalForRole = (role: Role): Portal => (role === 'STUDENT' ? 'student' : 'staff');
export const roleAllowedOnPortal = (role: Role, portal: Portal): boolean => portalForRole(role) === portal;

/** Pages (first path segment) both portals serve: sign-in, recovery, public certificate verification, MFA step, the role-aware dashboard and profile. */
const SHARED_PAGES = ['', 'login', 'forgot', 'verify', 'mfa', 'dashboard', 'profile'] as const;
/** Candidate-only pages. These call `/me/*` endpoints that only the STUDENT role holds. */
const STUDENT_PAGES = ['schedule', 'results', 'performance', 'exam', 'certificate', 'register'] as const;
/** Staff-only pages (see apps/web/src/nav.ts for which role sees which). */
const STAFF_PAGES = ['questions', 'exams', 'students', 'enrolment', 'roster', 'assignments', 'users', 'teachers', 'classes', 'pools', 'my-students', 'institutions', 'programs', 'monitor', 'incidents', 'audit'] as const;

const PAGES: Record<Portal, ReadonlySet<string>> = {
  student: new Set<string>([...SHARED_PAGES, ...STUDENT_PAGES]),
  staff: new Set<string>([...SHARED_PAGES, ...STAFF_PAGES]),
};

/** Whether a PAGE path may be served on a portal. Matches whole first segments, so `/exam` ≠ `/exams`. Not for `/api` or framework assets. */
export function isPagePathAllowedOnPortal(pathname: string, portal: Portal): boolean {
  const first = pathname.split('?')[0]!.split('#')[0]!.replace(/^\/+/, '').split('/')[0]!.toLowerCase();
  return PAGES[portal].has(first);
}
