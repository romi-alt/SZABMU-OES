# 04 — Domain and routing plan

**Nothing in this document has been applied.** DNS is not modified until the release gate (doc 08, G3).

## Public contract

| Hostname | Audience | Serves | Backend |
|---|---|---|---|
| `oes.szabmu.site` | candidates (role STUDENT) | student pages, `/api/` | shared API |
| `dashboard.szabmu.site` | university staff (all other roles) | staff pages, `/api/` | shared API |

The API itself has **no public hostname**. It listens on `127.0.0.1:4000` and is reached only through nginx.

### Why no `api.szabmu.site`

A separate API origin would force one of: CORS with credentials + `SameSite=None` cookies, or a parent-domain cookie (`Domain=.szabmu.site`) shared by both portals. Both defeat the isolation required here. The application is already built for same-origin: the browser calls relative `/api/…`, CSP is `connect-src 'self'`, the cookie is host-only, and the CSRF Origin allow-list takes the two origins. A proxy path is the smaller and safer change. **No concrete technical need for an API domain was found.**

## DNS records to add at the release gate (zone `szabmu.site`)

| Name | Type | Value | TTL |
|---|---|---|---|
| `oes` | A | `168.231.82.140` | 300 |
| `oes` | AAAA | `2a02:4780:28:fca1::1` | 300 |
| `dashboard` | A | `168.231.82.140` | 300 |
| `dashboard` | AAAA | `2a02:4780:28:fca1::1` | 300 |
| `@` | CAA | `0 issue "letsencrypt.org"` | 3600 (optional, recommended) |

Leave the existing `@ A 2.57.91.91` and `www CNAME` records **untouched**. Mail records (SPF/DKIM/DMARC) for whichever relay sends recovery codes are added separately once the provider is chosen. Add records only after the VPS is reactivated, nginx is configured, and the rehearsal passed.

## Request routing (templates in `infra/hostinger/nginx/`)

| Path on either host | Goes to | Notes |
|---|---|---|
| `/api/metrics` | **404** | Scraped locally with the bearer token; never public. |
| `/api/me/exams/*/stream` (student) · `/api/invigilation/exams/*/stream` (staff) | api | SSE: `proxy_buffering off`, `proxy_cache off`, `gzip off`, `proxy_read_timeout 3600s`; the browser reconnects with `Last-Event-ID`. The API already sends `X-Accel-Buffering: no`. |
| `/api/auth/{login,forgot,verify-code,reset}` | api | Generous `limit_req` only (campus NAT), `Cache-Control: no-store`. |
| `/api/…` (answer saves, start, submit, results, everything else) | api | `Cache-Control: no-store`; **no `proxy_cache` anywhere**; sets `X-OES-Portal` to the vhost's portal, overwriting any client value. |
| everything else | the portal's Next.js process | Pages, `_next/static` assets. |

## What must never be cached

Authenticated API responses, answer-save and submit calls, unpublished papers (`/api/attempts/*`, `/api/exams/*/paper`), results and certificates, the SSE streams, `/api/auth/*`, `/api/me/*`. The templates configure no proxy cache; they add `no-store` on `/api/`. Immutable Next assets under `/_next/static/` may be cached by the browser (Next already marks them).

## Proxy settings that protect the exam path

| Setting | Why |
|---|---|
| `X-Forwarded-For $remote_addr` (overwrite, not append) + API `TRUST_PROXY=true` | Rate limits and the audit trail use the real client IP, not a client-supplied one. |
| `client_max_body_size 2m` | Matches the API's 2 MiB body limit. Saves are tiny JSON. |
| `proxy_http_version 1.1`, `Connection ""`, keepalive upstream | Fewer connections during the save storm. |
| No `limit_req` on answer-save paths | Per-attempt limit exists in the API (100 / 10 s); an edge per-IP limit would punish a whole campus behind one NAT. |
| HSTS `max-age=31536000` **without** `includeSubDomains`/`preload` | The parent domain is not served from this VPS. |
| Access log without cookies or query strings | Public verification carries a code in the query. |

## Large medical images

There is no upload or image-serving path in the code today (G9). When one is added: serve **approved, immutable** images from object storage or an nginx static location with long cache and a content hash in the URL; keep unpublished-paper media behind the authenticated API; set `CSP_MEDIA_ORIGIN` to that https origin; raise `client_max_body_size` only on the staff upload route.

## Route allow-lists per portal (`packages/shared/src/portal.ts`)

| Portal | Pages served | Everything else |
|---|---|---|
| student | `/`, `login`, `forgot`, `verify`, `mfa`, `dashboard`, `profile`, `schedule`, `results`, `performance`, `exam/*`, `certificate/*` | branded 404 |
| staff | `/`, `login`, `forgot`, `verify`, `mfa`, `dashboard`, `profile`, `questions`, `exams/*` (incl. control centre), `students`, `enrolment`, `assignments`, `users`, `institutions`, `programs`, `monitor/*`, `incidents`, `audit` | branded 404 |

Public certificate verification (`/verify`, `GET /api/public/verify`) works on both.
