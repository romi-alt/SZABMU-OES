# 08 — Environment variables

Inventory read from `apps/api/src/config.ts`, `apps/web/next.config.mjs`, `apps/web/src/proxy.ts`, `apps/web/src/csp.ts` and the lifecycle code `[CODE]`. **No value is committed anywhere.** Set them in Hostinger per site (full-replace semantics: always send the complete set). Never put a secret in a `NEXT_PUBLIC_*` variable — the code has none, and the build embeds those.

## API site (Hostinger) and the worker (external) — same variables, different `RUN_WORKERS`
| Variable | Secret | API site | Worker | Notes |
|---|---|---|---|---|
| `NODE_ENV` | | `production` | `production` | production gates are enforced at boot |
| `PORT` / `API_PORT`, `API_HOST` | | platform `PORT` | n/a | `PORT` honoured (new); `API_HOST` default `0.0.0.0` |
| `DATABASE_URL` | **yes** | required | required | `postgresql://…?sslmode=require` (gate refuses otherwise); separate per environment |
| `DB_POOL_MAX` | | 10–20 | 10 | size against the provider's connection limit |
| `REDIS_URL` | **yes** | required | required | `rediss://:password@host:port` (gate refuses no-password) |
| `WEB_ORIGIN` | | `https://oes.szabmu.site,https://dashboard.szabmu.site` | same | exact list; https only |
| `COOKIE_SECRET`, `RECEIPT_SECRET`, `MFA_KEY` | **yes** | ≥ 32 random chars each, all distinct | **same values as the API** (receipts and TOTP seeds must verify across processes) | `openssl rand -base64 48` |
| `METRICS_TOKEN` | **yes** | ≥ 24 chars | optional | `/api/metrics` is off without it; required in production |
| `MFA_ENFORCE` | | `true` | `true` | required in production |
| `PORTAL_ENFORCE` | | `true` (once Mode 1 or 2 is implemented) | `true` | required by the production gate; **enabling it before the portal mode exists locks everyone out** |
| `TRUST_PROXY` | | `true` **only after blocker B-06** | `false` | see doc 06 |
| `RUN_WORKERS` | | **`false`** | forced `true` by `worker.ts` | never `true` in a Hostinger web process |
| `SESSION_TTL_HOURS` | | 12 (≤ 24) | | |
| `DEV_EXPOSE_CODES` | | `false` | `false` | `true` leaks reset codes; refused in production |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | | relay host/587 | same | **the code cannot authenticate to SMTP** (blocker B-08): use an unauthenticated STARTTLS relay or add SMTP auth |
| `S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY` | **yes** (keys) | unset | unset | read by config, **no code path uses object storage yet** |
| `LOGIN_RATE_IP_MAX`, `LOGIN_RATE_ID_MAX` | | leave unset (defaults 60/20 enforced) | | campus-NAT policy open (risk R-07) |
| `LIFECYCLE_INTERVAL_MS` (5000), `LIFECYCLE_LEASE_SECONDS` (15), `LIFECYCLE_CONCURRENCY` (8) | | n/a | optional | tuning |
| `RECONCILE_TIMEOUT_MS` (120000) | | | cron | hard stop for the finite pass |
| `DB_ALLOW_PLAINTEXT`, `REDIS_ALLOW_NOAUTH`, `ALLOW_NO_PROXY` | | **never set** | | escape hatches for isolated networks only |

## Web sites (student, staff)
| Variable | Secret | Value | Notes |
|---|---|---|---|
| `NODE_ENV` | | `production` | |
| `PORTAL` | | `student` / `staff` | page allow-list (`packages/shared/src/portal.ts`); unset = every page (dev) |
| `API_INTERNAL_URL` | | `https://<API site hostname>` | destination of the `/api/*` rewrite; **not secret, not `NEXT_PUBLIC_`** |
| `CSP_MEDIA_ORIGIN` | | unset until object storage exists | https origins for question images |
| `CSP_UPGRADE_INSECURE` | | `true` | adds `upgrade-insecure-requests` |
| *(Mode 1 only)* `BFF_SHARED_SECRET` | **yes** | random 48 | also set on the API; not implemented yet |

## Cron / worker host extras
The reconcile cron needs the **API** variables (database, Redis, secrets) because it boots the same application context. Keep the cron's environment identical to the API site's except `RUN_WORKERS` (the command forces `false`).
