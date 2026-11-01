#!/usr/bin/env node
/**
 * Single-site launcher for Hostinger managed Node.js hosting (DEMO topology).
 *
 * Hostinger gives one Node.js process per website, and the account has a single free Node.js slot, so this one process:
 *   1. spawns the NestJS API (apps/api/dist/main.js) as a child process bound to loopback only (127.0.0.1:API_PORT), and
 *   2. serves the Next.js app (apps/web) in-process on the port Hostinger assigns (PORT).
 * The browser only ever talks to Next; Next forwards /api/* to the API through the rewrite in apps/web/next.config.mjs,
 * whose destination (API_INTERNAL_URL) is baked in at BUILD time — so API_INTERNAL_URL must be set in the site's environment before building.
 *
 * Why the API child runs with NODE_ENV=development: this is a seeded demo. NODE_ENV=production activates productionProblems(),
 * which (correctly) demands PORTAL_ENFORCE and MFA_ENFORCE — neither is usable on a single host-agnostic demo site with synthetic accounts.
 * DEV_EXPOSE_CODES stays false. See docs/deployment/hostinger-demo/README.md.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));

const PORT = Number(process.env.PORT) || 3000;
const API_PORT = Number(process.env.API_PORT) || 47321;
const API_NODE_ENV = process.env.API_NODE_ENV || 'development';

let api = null;
let stopping = false;
let restarts = 0;

function startApi() {
  const env = { ...process.env, NODE_ENV: API_NODE_ENV, API_PORT: String(API_PORT), API_HOST: '127.0.0.1' };
  delete env.PORT; // the API prefers PORT over API_PORT; PORT belongs to the public Next server
  api = spawn(process.execPath, [path.join(root, 'apps/api/dist/main.js')], { cwd: path.join(root, 'apps/api'), env, stdio: 'inherit' });
  const startedAt = Date.now();
  api.on('exit', (code, signal) => {
    if (stopping) return;
    if (Date.now() - startedAt > 60_000) restarts = 0;
    const delay = Math.min(1000 * 2 ** restarts++, 30_000);
    console.error(`[launcher] API exited (code=${code} signal=${signal}); restarting in ${delay} ms`);
    setTimeout(startApi, delay);
  });
}

async function startWeb() {
  process.env.NODE_ENV = 'production';
  const next = require('next');
  const app = next({ dev: false, dir: path.join(root, 'apps/web'), hostname: '0.0.0.0', port: PORT });
  await app.prepare();
  const handle = app.getRequestHandler();
  createServer((req, res) => handle(req, res)).listen(PORT, () => console.log(`[launcher] web on :${PORT}, API on 127.0.0.1:${API_PORT}`));
}

function shutdown() {
  stopping = true;
  api?.kill('SIGTERM');
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startApi();
startWeb().catch((e) => { console.error('[launcher] web failed to start', e); shutdown(); process.exitCode = 1; });
