import type { Portal } from '@oes/shared';
/** Public addresses of the two portals (build-time, overridable). Used only to link ACROSS portals; same-portal links stay relative. */
export const STUDENT_URL = (process.env.NEXT_PUBLIC_STUDENT_PORTAL_URL ?? 'https://oes.szabmu.site').replace(/\/$/, '');
export const STAFF_URL = (process.env.NEXT_PUBLIC_STAFF_PORTAL_URL ?? 'https://dashboard.szabmu.site').replace(/\/$/, '');
/** Where a teacher registers: the student-facing host. On a single-portal host (development) it is the same site. */
export const teacherRegisterHref = (portal: Portal | null) => (portal === 'staff' ? `${STUDENT_URL}/register/teacher` : '/register/teacher');
/** Where a teacher signs in once registered: the staff host. */
export const staffSignInHref = (portal: Portal | null) => (portal === 'student' ? `${STAFF_URL}/login` : '/login');
