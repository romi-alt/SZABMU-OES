import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** The real page routes of the web app, derived from the Next.js file tree (route groups removed, [param] → :param). */
const APP_DIR = path.resolve(__dirname, '../../web/src/app');
export function webRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, /^\(.*\)$/.test(name) ? segs : [...segs, name.replace(/^\[(.+)\]$/, ':$1')]);
      else if (name === 'page.tsx') out.push('/' + segs.join('/'));
    }
  };
  walk(APP_DIR, []);
  return out;
}
export const routeExists = (p: string, routes = webRoutes()) =>
  routes.some((r) => new RegExp('^' + r.replace(/:[^/]+/g, '[^/]+') + '$').test(p));
