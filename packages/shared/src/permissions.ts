import type { Role } from './roles';

/**
 * Single source of truth for server-side authorization.
 * Every API route declares exactly one permission; the guard checks the
 * role matrix here and the service layer then applies institution scope.
 */
export const PERMISSIONS = {
  // identity & administration
  'user.manage': ['SUPER_ADMIN', 'CAMPUS_ADMIN'],
  'user.manage_global': ['SUPER_ADMIN'],
  'institution.read': ['SUPER_ADMIN', 'CCE', 'EXAMINER', 'CAMPUS_ADMIN', 'LECTURER', 'INVIGILATOR'],
  'institution.manage': ['SUPER_ADMIN'],
  'department.manage': ['SUPER_ADMIN', 'CAMPUS_ADMIN'],
  'program.read': ['SUPER_ADMIN', 'CCE', 'EXAMINER', 'CAMPUS_ADMIN', 'LECTURER', 'INVIGILATOR', 'STUDENT'],
  'program.manage': ['SUPER_ADMIN', 'CCE'],
  // students
  'student.read': ['SUPER_ADMIN', 'CCE', 'EXAMINER', 'CAMPUS_ADMIN', 'LECTURER', 'INVIGILATOR'],
  'student.manage': ['SUPER_ADMIN', 'CAMPUS_ADMIN'],
  'enrollment.manage': ['SUPER_ADMIN', 'CAMPUS_ADMIN'],
  'eligibility.override': ['SUPER_ADMIN', 'CCE'],
  // question bank & papers
  'course.assign': ['SUPER_ADMIN', 'CAMPUS_ADMIN'],
  'question.read': ['SUPER_ADMIN', 'EXAMINER', 'CCE', 'LECTURER'],
  'question.write': ['LECTURER', 'EXAMINER', 'SUPER_ADMIN'],
  'question.approve': ['EXAMINER', 'CCE', 'SUPER_ADMIN'],
  'paper.build': ['EXAMINER', 'LECTURER', 'SUPER_ADMIN'],
  'paper.approve': ['EXAMINER', 'CCE', 'SUPER_ADMIN'],
  // exams
  'exam.read': ['SUPER_ADMIN', 'CCE', 'EXAMINER', 'CAMPUS_ADMIN', 'LECTURER', 'INVIGILATOR'],
  'exam.schedule': ['EXAMINER', 'CCE', 'SUPER_ADMIN'],
  'exam.sit': ['STUDENT'],
  'invigilator.assign': ['SUPER_ADMIN', 'CCE', 'EXAMINER', 'CAMPUS_ADMIN'],
  // live exam control (central command centre). Campus staff keep campus-scoped monitoring via `invigilation.*` and gain no exam-wide control.
  'exam.control.view': ['EXAMINER', 'CCE', 'SUPER_ADMIN'],
  'exam.control': ['CCE', 'SUPER_ADMIN'],
  'exam.control.policy': ['CCE', 'SUPER_ADMIN'],
  // invigilation
  'invigilation.monitor': ['INVIGILATOR', 'CAMPUS_ADMIN', 'EXAMINER', 'CCE', 'SUPER_ADMIN'],
  'invigilation.intervene': ['INVIGILATOR', 'CCE', 'SUPER_ADMIN'],
  'incident.report': ['INVIGILATOR', 'CAMPUS_ADMIN', 'EXAMINER', 'CCE', 'SUPER_ADMIN'],
  'incident.resolve': ['CCE', 'EXAMINER', 'SUPER_ADMIN'],
  // grading & results
  'grading.review': ['LECTURER', 'EXAMINER', 'SUPER_ADMIN'],
  'grading.keyaction': ['EXAMINER', 'SUPER_ADMIN'],
  'result.read_scoped': ['SUPER_ADMIN', 'CCE', 'EXAMINER', 'CAMPUS_ADMIN', 'LECTURER'],
  'result.approve_examiner': ['EXAMINER', 'SUPER_ADMIN'],
  'result.publish': ['CCE', 'SUPER_ADMIN'],
  'result.read_own': ['STUDENT'],
  'certificate.issue': ['CCE', 'SUPER_ADMIN'],
  // cross-cutting
  'report.read': ['SUPER_ADMIN', 'CCE', 'EXAMINER', 'CAMPUS_ADMIN'],
  'audit.read': ['SUPER_ADMIN', 'CCE', 'CAMPUS_ADMIN'],
  'notification.send': ['SUPER_ADMIN', 'CCE', 'CAMPUS_ADMIN', 'EXAMINER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
