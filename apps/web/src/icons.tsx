import type { ReactNode } from 'react';

/** One line-icon set (24×24, 1.6 stroke, currentColor) for the whole product: menus, page headings, auth fields. */
const P = {
  user: <><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4" /></>,
  userPlus: <><circle cx="10" cy="8" r="3.6" /><path d="M3.5 20c.7-3.4 3.2-5.2 6.5-5.2 1.3 0 2.4.3 3.4.8M18 14v6M15 17h6" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M2.8 19.5c.7-3.2 3-4.8 6.2-4.8s5.5 1.6 6.2 4.8M16 5.6a3.1 3.1 0 0 1 0 5.8M18 14.9c1.8.5 3 1.9 3.4 4.1" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7.5 8 6 8-6" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  id: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="11" r="2" /><path d="M5.8 16c.4-1.5 1.6-2.2 3.2-2.2s2.8.7 3.2 2.2M14.5 10h4M14.5 13.5h3" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 5.7c.4-.1.9-.2 1.4-.2 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.4 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-.9" /><path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 3.7" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  laptop: <><rect x="5" y="5" width="14" height="10" rx="1.8" /><path d="M2.5 19h19l-1.6-4H4.1L2.5 19Z" /></>,
  shieldCheck: <><path d="M12 3.5 19.5 6v5.5c0 4.5-3.1 8-7.5 9-4.4-1-7.5-4.5-7.5-9V6L12 3.5Z" /><path d="m8.8 12 2.2 2.2 4.2-4.4" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  dashboard: <><rect x="3.5" y="3.5" width="7.5" height="9" rx="2" /><rect x="13" y="3.5" width="7.5" height="5.5" rx="2" /><rect x="13" y="11.5" width="7.5" height="9" rx="2" /><rect x="3.5" y="14.5" width="7.5" height="6" rx="2" /></>,
  schedule: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4M8 14h3M13 14h3M8 17h3" /></>,
  results: <><path d="M6 3.5h9l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6 3.5Z" /><path d="M14.5 3.8V8h4M8.5 13l2 2 4-4.5" /></>,
  performance: <><path d="M4 20V10M10 20V5M16 20v-7M21 20H3" /></>,
  questions: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6M12 16.6h.01" /></>,
  exams: <><path d="M7 3.5h10A1.5 1.5 0 0 1 18.5 5v15A1.5 1.5 0 0 1 17 21.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" /><path d="M9 8h6M9 12h6M9 16h3.5" /></>,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2.2" /><path d="M8 20h8M12 16.5V20M7 11l2.5-2.5 2.5 3 2.5-4L17 11" /></>,
  incidents: <><path d="M12 3.8 21 19.5H3L12 3.8Z" /><path d="M12 10v4.2M12 17h.01" /></>,
  students: <><path d="m3 9 9-4.5L21 9l-9 4.5L3 9Z" /><path d="M7 11.2V16c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.8M21 9v5.5" /></>,
  enrolment: <><path d="M9 4.5h6a1.5 1.5 0 0 1 1.5 1.5v1H7.5V6A1.5 1.5 0 0 1 9 4.5Z" /><rect x="4.5" y="6.5" width="15" height="14" rx="2" /><path d="m8.5 14 2.5 2.5 4.5-5" /></>,
  institutions: <><path d="M3 20.5h18M5 20.5V10M9.5 20.5V10M14.5 20.5V10M19 20.5V10M3 9l9-5.5L21 9H3Z" /></>,
  programs: <><path d="M4.5 5.5C7 4.5 9.5 4.7 12 6.5c2.5-1.8 5-2 7.5-1v13c-2.5-1-5-.8-7.5 1-2.5-1.8-5-2-7.5-1v-13Z" /><path d="M12 6.5v13" /></>,
  assignments: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3 2.8-4.6 6-4.6M15 16l2 2 4-4.2" /></>,
  audit: <><path d="M12 3.5 19.5 6v5.5c0 4.5-3.1 8-7.5 9-4.4-1-7.5-4.5-7.5-9V6L12 3.5Z" /><path d="m9 12 2.2 2.2L15.2 10" /></>,
  roster: <><rect x="4.5" y="3.5" width="15" height="17" rx="2.2" /><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5l1.5-2Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  logout: <><path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 8l-4 4 4 4M6 12h10" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  certificate: <><rect x="3.5" y="4.5" width="17" height="12" rx="2" /><circle cx="12" cy="10.5" r="2.4" /><path d="m9.5 16.5-1 4 3.5-1.8 3.5 1.8-1-4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  shield: <><path d="M12 3.5 19.5 6v5.5c0 4.5-3.1 8-7.5 9-4.4-1-7.5-4.5-7.5-9V6L12 3.5Z" /></>,
  key: <><circle cx="8" cy="15" r="3.6" /><path d="m10.6 12.4 8.4-8.4M15.5 7.5l2.5 2.5M13.5 9.5l1.8 1.8" /></>,
  alert: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.2M12 16.2h.01" /></>,
  fileX: <><path d="M6 3.5h9l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6 3.5Z" /><path d="m9.5 12.5 5 5M14.5 12.5l-5 5" /></>,
} satisfies Record<string, ReactNode>;
export type IconName = keyof typeof P;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">{P[name]}</svg>;
}

/** Icon for a route (menu entries and page headings use the same one). */
const BY_ROUTE: [string, IconName][] = [
  ['/dashboard', 'dashboard'], ['/schedule', 'schedule'], ['/results', 'results'], ['/performance', 'performance'], ['/profile', 'user'], ['/questions', 'questions'],
  ['/exams', 'exams'], ['/monitor', 'monitor'], ['/incidents', 'incidents'], ['/my-students', 'students'], ['/classes', 'programs'], ['/pools', 'questions'], ['/teachers', 'assignments'], ['/students', 'students'], ['/enrolment', 'enrolment'], ['/assignments', 'assignments'],
  ['/users', 'users'], ['/audit', 'audit'], ['/institutions', 'institutions'], ['/programs', 'programs'], ['/roster', 'roster'], ['/certificate', 'certificate'],
];
export const iconForRoute = (full: string): IconName => { const path = full.split('?')[0]!; return BY_ROUTE.find(([p]) => path === p || path.startsWith(p + '/'))?.[1] ?? 'dashboard'; };
