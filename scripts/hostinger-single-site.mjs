#!/usr/bin/env node
/**
 * Single-site launcher for Hostinger managed Node.js hosting (DEMO topology).
 *
 * Hostinger gives one Node.js process per website, and the account has a single free Node.js slot, so ONE process serves everything
 * on the port Hostinger assigns (PORT):
 *   - /api/*  → the NestJS API (apps/api), mounted in-process: its Fastify instance handles the raw request (`fastify.routing`);
 *   - else    → the Next.js app (apps/web), via its request handler.
 * There is deliberately no second TCP port: on Hostinger's shared web servers a loopback port bound by a child process was reported
 * as EADDRINUSE yet refused connections (see docs/deployment/hostinger-demo/README.md, "Lessons").
 *
 * NODE_ENV: the API is created with API_NODE_ENV (default `development`) because this is a seeded demo — NODE_ENV=production activates
 * productionProblems(), which demands PORTAL_ENFORCE and MFA_ENFORCE. The API reads its configuration exactly once, inside createApp(),
 * so NODE_ENV is switched to `production` afterwards, before Next.js starts. DEV_EXPOSE_CODES stays false.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoMigrate } from './auto-migrate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const PORT = Number(process.env.PORT) || 3000;

async function startApi() {
  process.env.NODE_ENV = process.env.API_NODE_ENV || 'development';
  const { createApp } = require(path.join(root, 'apps/api/dist/bootstrap.js'));
  const app = await createApp();
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return { app, route: (req, res) => fastify.routing(req, res) };
}

async function startWeb() {
  process.env.NODE_ENV = 'production';
  const next = require('next');
  const web = next({ dev: false, dir: path.join(root, 'apps/web'), hostname: '0.0.0.0', port: PORT });
  await web.prepare();
  return web.getRequestHandler();
}

const isApi = (url = '') => url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');

/**
 * Two portals on one process: PORTAL_HOSTS maps host names to portals, e.g.
 *   PORTAL_HOSTS="oes.szabmu.site=student,dashboard.szabmu.site=staff"
 * Every request's X-OES-Portal header is overwritten here (a client-sent value is always discarded), so the API's PORTAL_ENFORCE
 * and the web proxy's page rules see the portal of the host name the browser actually used. Unknown hosts get no portal.
 */
const PORTAL_HOSTS = new Map(
  (process.env.PORTAL_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase().split('=')).filter(([h, p]) => h && (p === 'student' || p === 'staff')),
);
function stampPortal(req) {
  delete req.headers['x-oes-portal'];
  // Host only — X-Forwarded-Host can be supplied by the client and would let it pick a portal.
  const host = String(req.headers.host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  const portal = PORTAL_HOSTS.get(host);
  if (portal) req.headers['x-oes-portal'] = portal;
}

async function main() {
  autoMigrate(root);                       // additive, idempotent, never fatal (see scripts/auto-migrate.mjs)
  const api = await startApi();
  if (PORTAL_HOSTS.size) process.env.PORTAL_FROM_HEADER = 'true';
  const web = await startWeb();
  const server = createServer((req, res) => { stampPortal(req); return isApi(req.url) ? api.route(req, res) : web(req, res); });
  server.listen(PORT, () => console.error(`[launcher] serving web + API on :${PORT} (node ${process.version})`));
  const shutdown = () => { server.close(); api.app.close().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error('[launcher] failed to start', e); process.exit(1); });
