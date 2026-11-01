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

async function main() {
  const api = await startApi();
  const web = await startWeb();
  const server = createServer((req, res) => (isApi(req.url) ? api.route(req, res) : web(req, res)));
  server.listen(PORT, () => console.error(`[launcher] serving web + API on :${PORT} (node ${process.version})`));
  const shutdown = () => { server.close(); api.app.close().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error('[launcher] failed to start', e); process.exit(1); });
