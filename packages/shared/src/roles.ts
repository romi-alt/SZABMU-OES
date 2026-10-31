export const ROLES = [
  'STUDENT',
  'LECTURER',
  'EXAMINER',
  'CAMPUS_ADMIN',
  'INVIGILATOR',
  'CCE',
  'SUPER_ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'Student',
  LECTURER: 'Lecturer',
  EXAMINER: 'Examiner',
  CAMPUS_ADMIN: 'Campus Administrator',
  INVIGILATOR: 'Invigilator',
  CCE: 'Controller of Examinations',
  SUPER_ADMIN: 'Super Administrator',
};

/** Roles whose data access is limited to the institutions assigned to them. */
export const CAMPUS_SCOPED_ROLES: readonly Role[] = ['STUDENT', 'LECTURER', 'CAMPUS_ADMIN', 'INVIGILATOR'];
/** Roles with university-wide reach (still limited by permission). */
export const UNIVERSITY_WIDE_ROLES: readonly Role[] = ['EXAMINER', 'CCE', 'SUPER_ADMIN'];

export function isCampusScoped(role: Role): boolean {
  return CAMPUS_SCOPED_ROLES.includes(role);
}
