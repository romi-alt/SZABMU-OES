# 06 — Student and staff authentication

Principle: sharing `szabmu.site` grants nothing. A session belongs to one hostname and one role class, and the API authorises **every** request itself.

## What exists `[CODE]`
Opaque server-side session (hashed token in `sessions`), cookie `oes_session`: `HttpOnly; Secure (production); SameSite=Lax; Path=/`, **no `Domain`** (host-only). Argon2id; lockout 5 failures / 15 min; 20 attempts per account and 60 per IP per 15 min; TOTP MFA enforced for SUPER_ADMIN, CCE, EXAMINER, CAMPUS_ADMIN (`MFA_ENFORCE=true` mandatory in production); every handler has `@Perm(...)` and is **deny-by-default**; data scoped by institution (`scope.filter`); CSRF: a state-changing request with a foreign `Origin` is refused (`WEB_ORIGIN` allow-list, comma-separated). Public endpoints: `login`, `forgot`, `verify-code`, `reset`, `public/verify`, `health`, `metrics` (token). **There is no sign-up endpoint**; accounts are created by administrators.
Added on this branch's parent commit and **off by default**: `PORTAL_ENFORCE` (role ↔ portal check at sign-in and on every request, fail closed; required in production) and the web `PORTAL` page gate.

## Behaviour per portal

| | Student `oes.szabmu.site` | Staff `dashboard.szabmu.site` |
|---|---|---|
| Roles | STUDENT only | LECTURER, EXAMINER, CAMPUS_ADMIN, INVIGILATOR, CCE, SUPER_ADMIN |
| Cookie | host-only on `oes.` | host-only on `dashboard.` — **never `Domain=.szabmu.site`** |
| Sign-up | see "Student sign-up" below | **none, ever**; staff are created and role-assigned by an administrator (`POST /users`, `user.manage`), audited |
| MFA | optional TOTP | required for four roles; **recommended for all staff** (policy decision, LECTURER/INVIGILATOR currently exempt) |
| Recovery | e-mail code → single-use token (Redis) | same; staff recovery should additionally notify the administrator |
| Logout | clears cookie, `sessions.revokedAt`, drops the Redis cache entry, audited | same |
| Revocation | admin deactivation / password reset drops all sessions | same |

## How the API learns which portal a request came through (the open design point)

Without nginx the portal cannot be a trusted proxy header by default. Two modes, to be decided by a staging test (doc 10, tests A-1/A-2):

| Mode | How | Strength | Cost | Status |
|---|---|---|---|---|
| **1 — BFF-signed header** | Each portal's Next.js server has a route handler for `/api/*` that forwards the call with `X-OES-Portal` and an HMAC (portal, client IP, timestamp) using a shared secret; the API trusts portal and client IP **only** with a valid signature and otherwise fails closed. A browser calling the API host directly gets 403. | strongest; also solves client-IP trust | new code; all API traffic (including SSE) passes through the web process; unverified streaming behaviour | designed, **not implemented** |
| **2 — Origin-based** | Keep Next `rewrites` (existing, e2e-proven). The API maps the request `Origin` (always sent on sign-in and state-changing requests) to a portal and refuses a role on the wrong one; reads rely on the host-only cookie. | small change, no new hop | `Origin` is forgeable by non-browser clients (they still need valid credentials and the role's own permissions); depends on the rewrite proxy forwarding `Origin` | designed, **not implemented** |
| header (current code) | nginx sets `X-OES-Portal` | fine on a VPS | needs a proxy we do not control here | **implemented**, unsuitable on managed hosting unless Mode 1 supplies the header |

Either mode keeps the independent controls: host-only cookies, `@Perm` on every route, institution scoping, deny-by-default.

## Client-IP trust (a real hazard on this platform)
`TRUST_PROXY=true` makes Fastify trust the **whole** `X-Forwarded-For` chain, taking the leftmost entry — which a client can forge. With Hostinger's edge → Next rewrite → API (edge again), the real client is not the first or last hop in a way the boolean can express. Rate limits and the audit trail then use a forgeable address. Needed: a hop-count (or signed-IP, Mode 1) setting. **Blocker B-06.** Until fixed, per-IP limits and audit IPs must not be relied on.

## CSRF and origins
Set `WEB_ORIGIN=https://oes.szabmu.site,https://dashboard.szabmu.site` (exactly the two; https only — production refuses anything else). A request with **no** `Origin` is accepted today (gap G6); `SameSite=Lax` covers browsers. Recommended: require `Origin` on state-changing requests in production.

## Cookie tossing
Hostinger hosts the zone; the apex `szabmu.site` is operated elsewhere. A sibling site could set a `Domain=.szabmu.site` cookie named `oes_session`. Rename to **`__Host-oes_session`** in production (browsers then reject any domain-scoped cookie of that name). Not yet done.

## Student sign-up, e-mail verification and identity linking — **NOT IMPLEMENTED, policy needed**
The brief lists sign-up. The system today has none, deliberately. A free-form sign-up would let anyone claim an examination identity, so it must be a **claim of a pre-registered record**, never account creation from scratch. Proposed design for approval:

1. The campus administrator imports the student roster (`POST /students/import`) — registration number, institution, programme, **institutional e-mail**; no account is usable yet.
2. The student enters registration number + institution; the system sends a **single-use, short-lived link to the registered e-mail only** (never to an address typed by the student), constant-time responses regardless of whether the record exists.
3. The link lets the student set a password (existing password policy), after which the account is active and linked to the roster row; one claim per record; every step audited; per-IP and per-record rate limits.
4. A second factor of identity (date of birth held in the record) is optional and a policy decision, because it is guessable.
5. Staff are never created this way and the staff host does not expose this flow.
Needs: the university's decision on which attributes are authoritative, who owns the roster, and working e-mail delivery (SPF/DKIM/DMARC). Until then students receive an administrator-issued temporary password (existing behaviour). **Blocker B-07.**
