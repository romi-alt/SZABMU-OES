import type { Role } from '@oes/shared';
export interface NavItem { href: string; label: string; badge?: 'notifications' }
export const NAV: Record<Role, { label: string; items: NavItem[] }> = {
  STUDENT: { label: 'Student portal', items: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/schedule', label: 'My Examinations' }, { href: '/results', label: 'Results' }, { href: '/performance', label: 'Performance' }, { href: '/profile', label: 'My profile' }] },
  TEACHER: { label: 'Teacher', items: [{ href: '/dashboard', label: 'Overview' }, { href: '/classes', label: 'My Classes & Subjects' }, { href: '/pools', label: 'MCQ Question Banks' }, { href: '/my-students', label: 'My Students' }, { href: '/submissions', label: 'Question Submissions' }, { href: '/profile', label: 'My Profile' }] },
  LECTURER: { label: 'Lecturer portal', items: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/questions', label: 'Question bank' }, { href: '/exams', label: 'Examinations' }, { href: '/students', label: 'Students' }, { href: '/profile', label: 'My profile' }] },
  EXAMINER: { label: 'Examiner department', items: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/questions', label: 'Question bank' }, { href: '/exams', label: 'Examinations' }, { href: '/monitor', label: 'Live monitor' }, { href: '/incidents', label: 'Incidents' }, { href: '/profile', label: 'My profile' }] },
  CAMPUS_ADMIN: { label: 'Campus administration', items: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/students', label: 'Students' }, { href: '/roster', label: 'Student register' }, { href: '/enrolment', label: 'Enrolment & eligibility' }, { href: '/assignments', label: 'Lecturer assignments' }, { href: '/teachers', label: 'Teachers' }, { href: '/users', label: 'Staff & accounts' }, { href: '/exams', label: 'Examinations' }, { href: '/monitor', label: 'Live monitor' }, { href: '/incidents', label: 'Incidents' }, { href: '/audit', label: 'Audit trail' }, { href: '/profile', label: 'My profile' }] },
  INVIGILATOR: { label: 'Invigilation', items: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/monitor', label: 'Live monitor' }, { href: '/incidents', label: 'Incidents' }, { href: '/profile', label: 'My profile' }] },
  CCE: { label: 'Controller of Examinations', items: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/exams', label: 'Examinations' }, { href: '/monitor', label: 'Live monitor' }, { href: '/incidents', label: 'Incidents' }, { href: '/enrolment', label: 'Enrolment & eligibility' }, { href: '/audit', label: 'Audit trail' }, { href: '/profile', label: 'My profile' }] },
  SUPER_ADMIN: { label: 'University administration', items: [{ href: '/dashboard', label: 'Dashboard' }, { href: '/institutions', label: 'Institutions' }, { href: '/programs', label: 'Programs & courses' }, { href: '/assignments', label: 'Lecturer assignments' }, { href: '/teachers', label: 'Teachers' }, { href: '/users', label: 'Users' }, { href: '/students', label: 'Students' }, { href: '/roster', label: 'Student register' }, { href: '/exams', label: 'Examinations' }, { href: '/monitor', label: 'Live monitor' }, { href: '/incidents', label: 'Incidents' }, { href: '/audit', label: 'Audit trail' }, { href: '/profile', label: 'My profile' }] },
};

/**
 * Pages that need a permission the API also enforces. The shell checks this BEFORE rendering a page, so a person who opens the wrong
 * URL always gets the same explanation (what the page is, who can use it, a way home) instead of a raw API error or a crash.
 * The API remains the authority; this is explanation, not security.
 */
export const ROUTE_RULES: { prefix: string; perm: string; name: string }[] = [
  { prefix: '/schedule', perm: 'exam.sit', name: 'My Examinations' },
  { prefix: '/results', perm: 'result.read_own', name: 'Results' },
  { prefix: '/performance', perm: 'result.read_own', name: 'Performance' },
  { prefix: '/questions', perm: 'question.read', name: 'Question bank' },
  { prefix: '/classes', perm: 'teacher.work', name: 'My Classes & Subjects' },
  { prefix: '/pools', perm: 'teacher.work', name: 'MCQ Question Banks' },
  { prefix: '/my-students', perm: 'teacher.work', name: 'My Students' },
  { prefix: '/submissions', perm: 'teacher.work', name: 'Question Submissions' },
  { prefix: '/teachers', perm: 'teacher.manage', name: 'Teachers' },
  { prefix: '/students', perm: 'student.read', name: 'Students' },
  { prefix: '/roster', perm: 'student.manage', name: 'Student register' },
  { prefix: '/enrolment', perm: 'student.read', name: 'Enrolment & eligibility' },
  { prefix: '/institutions', perm: 'institution.read', name: 'Institutions' },
  { prefix: '/assignments', perm: 'course.assign', name: 'Lecturer assignments' },
  { prefix: '/audit', perm: 'audit.read', name: 'Audit trail' },
  { prefix: '/users', perm: 'user.manage', name: 'Staff & accounts' },
  { prefix: '/monitor', perm: 'invigilation.monitor', name: 'Live monitor' },
  { prefix: '/incidents', perm: 'incident.report', name: 'Incidents' },
  { prefix: '/exams', perm: 'exam.read', name: 'Examinations' },
];
export const ruleFor = (path: string) => ROUTE_RULES.find((r) => path === r.prefix || path.startsWith(r.prefix + '/'));

/** Breadcrumb for routes that are not in the signed-in role's menu (never blank). */
const EXTRA_CRUMBS: Record<string, string> = { '/programs': 'Programs & courses', '/certificate': 'Certificate', '/dashboard': 'Dashboard', '/profile': 'My profile' };
export const crumbFor = (path: string) => ruleFor(path)?.name ?? Object.entries(EXTRA_CRUMBS).find(([p]) => path === p || path.startsWith(p + '/'))?.[1] ?? '';
