# Hostinger VPS deployment templates

**Superseded VPS templates (see `docs/deployment/README.md`). Templates only; nothing here has been executed, installed or deployed.** The plan, the gates and the open questions are in
[`docs/deployment/hostinger/`](../../docs/deployment/hostinger/) (start with `03-two-portal-architecture.md`, finish with `08-implementation-checklist.md`).

| File | Purpose | Validated |
|---|---|---|
| `docker-compose.prod.yml` | postgres + redis (private network, no published ports), api, web-student, web-staff (loopback only) | ✅ `docker compose config` (syntax and port exposure) |
| `env/*.env.example` | variable templates; real `*.env` files are created on the VPS and are git-ignored | — |
| `nginx/00-oes-http.conf`, `snippets/*`, `oes.szabmu.site.conf`, `dashboard.szabmu.site.conf` | TLS, per-host routing, `X-OES-Portal`, SSE, no-store | ❌ **not run through `nginx -t`** (no nginx available when written) — gate G2 |

Never put real secrets, certificates or backups in this directory (see `.gitignore`).
