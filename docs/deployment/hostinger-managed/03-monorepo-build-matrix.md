# 03 — Monorepo build matrix

Package manager: **npm workspaces** (`package-lock.json`, workspaces `packages/*` and `apps/*`). No pnpm. `[CODE]`

## Scripts that exist (read from the package files)

| Package | Script | Command |
|---|---|---|
| root | `build:shared` | `npm run build -w @oes/shared` (tsc → `packages/shared/dist`) |
| root (added in this branch) | `build:web` / `build:api` | `npm run build:shared && npm run build -w @oes/web` / `… @oes/api` |
| root (added) | `start:web`, `start:api`, `start:worker`, `reconcile` | web `next start`; `node apps/api/dist/main.js`; `node apps/api/dist/worker.js`; one finite lifecycle pass |
| `@oes/web` | `build` / `start` | `next build` / `next start -p ${PORT:-3000}` (**now honours the platform's `PORT`**) |
| `@oes/api` | `build` | `prisma generate && tsc -p tsconfig.build.json` → `apps/api/dist/main.js` |
| `@oes/api` | `start` / `worker` / `reconcile` / `db:migrate` | `node dist/main.js` / `node dist/worker.js` (**file now exists**) / `node dist/cron/reconcile.js` (**new**) / `prisma migrate deploy` |

**Dependency graph:** both apps import `@oes/shared` compiled output (`packages/shared/dist/index.js`). A build that skips `build:shared` fails. Prisma Client is generated into `apps/api/src/generated/` (git-ignored) by the API build; the web app does not use Prisma.

## Matrix

| Application | Repo root dir | Install | Build command | Output | Start / entry | Node | Domain |
|---|---|---|---|---|---|---|---|
| Student web | repo root (Config A) | `npm ci` at root | `npm run build:web` | `apps/web/.next` | `npm run start:web` with `PORTAL=student` | 24 | `oes.szabmu.site` |
| Staff web | repo root (Config A) | `npm ci` at root | `npm run build:web` | `apps/web/.next` | `npm run start:web` with `PORTAL=staff` | 24 | `dashboard.szabmu.site` |
| API | repo root (Config A) | `npm ci` at root | `npm run build:api` | `apps/api/dist` | entry file `apps/api/dist/main.js`, `app_type: nest`, `RUN_WORKERS=false` | 24 | `api.szabmu.site` (or the site's temporary hostname) |
| Worker (external) | repo root | `npm ci` | `npm run build:api` | `apps/api/dist` | `npm run start:worker` | 24 | none |
| Reconcile (Hostinger cron) | the API site's directory | — | — | — | `npm run reconcile` | 24 | none |

### Unknowns that decide Config A vs Config B `[NOT VERIFIED]`
Hostinger's `root_directory` means "where `package.json` is located". Two readings, both to be tried at staging:
- **Config A** — root directory is the repository root; install runs there (resolves workspaces); the build and start commands above run from the root. The `next` preset must be able to start from a root whose `package.json` has no `next` script.
- **Config B** — root directory is `apps/web` or `apps/api`; install runs *there*; workspace package `@oes/shared` (`"*"`) will **not** resolve unless install happens at the repository root.
If neither works, create **minimal deployment entry packages** (`deploy/student`, `deploy/staff`, `deploy/api` with their own `package.json` that build from the root via a script), without restructuring the services. That is a fallback, not done yet.

## What was proven in this session
Nothing was *built* here: the sandbox cannot reach the npm registry, so no production build of the student, staff or API app was run. The only build evidence is CI: the `verify` job (Node 26, existing) and the new **`node24`** job added on this branch (type-check, lint, unit and API tests, build, and a check that `main.js`, `worker.js` and `cron/reconcile.js` exist). **The student/staff builds are not "passing" until that job is green** — see `reliability-test-results.md`.

## hPanel values (per site) — to be entered by the account owner
Framework preset: Next.js (web) / NestJS (API) · Node.js: **24** · Package manager: npm · Root directory: repository root (Config A) · Build command: from the matrix · Entry file (API only): `apps/api/dist/main.js` · Branch: the release branch pinned at the release gate · Environment variables: doc 08.

## Build-time vs runtime variables
Web: only `CSP_*` and `PORTAL`/`API_INTERNAL_URL` are read, all at **runtime** (`proxy.ts`, `next.config.mjs`); there are **no `NEXT_PUBLIC_*` variables** in the code `[CODE]`, so no secret can leak into the client bundle and no rebuild is needed to change them. The API reads everything at runtime (`config.ts`).
