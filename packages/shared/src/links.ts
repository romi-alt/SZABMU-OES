/**
 * In-app destinations used by notifications. One definition for the API (which stores them) and the tests (which verify every
 * one resolves to a real page in apps/web/src/app). Paths are same-origin and un-prefixed: the portal shows each role its own
 * navigation under the same routes.
 */
export const LINKS = {
  schedule: '/schedule',
  results: '/results',
  incidents: '/incidents',
  questions: '/questions',
  monitor: '/monitor',
  teachers: '/teachers',
  students: '/students',
  pools: '/pools',
  classes: '/classes',
  exam: (examId: string) => `/exams/${examId}`,
} as const;

/** A stored link is only ever followed if it is a plain same-origin path. */
export const isSafeAppLink = (l: unknown): l is string => typeof l === 'string' && /^\/(?!\/)[\w\-./]*$/.test(l);
