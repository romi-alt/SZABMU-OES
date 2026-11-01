# 05 — Authentication boundaries

Principle: **sharing the parent domain `szabmu.site` grants nothing.** A session belongs to one hostname, one role class, and is checked by the API on every request.

## Behaviour per concern

| Concern | Student portal | Staff portal | Enforcement (where) |
|---|---|---|---|
| Who may sign in | role `STUDENT` only | the six staff roles only | `AuthService.login` (new, `PORTAL_ENFORCE`): correct credentials on the wrong portal → **401 `INVALID_CREDENTIALS`**, same message as a wrong password; audited as `auth.login_wrong_portal`, counted in `oes_auth_failures_total{kind="login_wrong_portal"}`. |
| Every later request | session must belong to `student` role | session must belong to a staff role | `AuthGuard` (new): wrong portal or missing header → **403 `WRONG_PORTAL`**. Fails closed. |
| Portal identity | `X-OES-Portal: student` set by nginx | `X-OES-Portal: staff` | nginx **overwrites** any client value; API reachable only on loopback; `PORTAL_ENFORCE=true` is a production requirement (`productionProblems`). |
| Cookie | `oes_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`, **no `Domain`** | same name, separate jar | Host-only: the browser never sends the student cookie to `dashboard.` or vice versa (verified by reading `auth.controller.ts`; to be verified in browser at rehearsal). |
| Cookie tossing | — | — | Apex `szabmu.site` is not ours. Recommended: rename to `__Host-oes_session` in production (browser refuses any domain-scoped cookie of that name). Backend change B5. |
| Session lifetime | 12 h default, max 24 h | same | `SESSION_TTL_HOURS`; production refuses > 24. Staff portal may be shortened by policy. |
| Logout | clears cookie, sets `sessions.revokedAt`, drops Redis session cache, audited | same | `AuthService.logout`. Revocation is immediate in the database; the 120 s Redis cache is explicitly invalidated. |
| Session revocation | admin deactivation / password reset drops all of a user's sessions | same | `dropUserSessions`. |
| MFA | not required for candidates (optional TOTP exists) | **required** for SUPER_ADMIN, CCE, EXAMINER, CAMPUS_ADMIN (`MFA_ENFORCE=true` mandatory in production); **not required for LECTURER, INVIGILATOR** | Policy decision G7: recommend requiring it for every role on the staff portal. |
| Password recovery | 6-digit code by e-mail, 10 min, 5 attempts, single-use reset token (Redis), identical responses for known/unknown accounts | same | Needs working mail (G3). `DEV_EXPOSE_CODES=false` is enforced in production. |
| Account creation | administrators only; **no public sign-up endpoint exists** (public routes: `login`, `forgot`, `verify-code`, `reset`, `public/verify`, `health`, `metrics`) | same | `POST /users`, `/students`, `/students/import` need `user.manage` / `student.manage`. |
| Authorisation | `@Perm(...)` on every handler, **deny by default** (`forbidden('Route has no declared permission')`), institution scoping via `scope.filter` | same | A student calling a staff API gets 403 even if the portal check were bypassed. |
| CSRF | `WEB_ORIGIN=https://oes.szabmu.site,https://dashboard.szabmu.site`; a wrong `Origin` on POST/PUT/PATCH/DELETE → 403; `SameSite=Lax` | same | Gap G6: a request with **no** Origin passes; recommend rejecting it in production (backend change B4). |
| Brute force | 5 failures → 15 min lock; 20 / 15 min per account; 60 / 15 min per IP | same | **Campus NAT problem (R-07).** |
| Rate-limit identity | real client IP | real client IP | `TRUST_PROXY=true` + nginx `X-Forwarded-For $remote_addr`. |

## Isolation tests (written, run in CI)

`apps/api/test/portal.test.ts`: student refused on staff portal and vice-versa for five staff roles (identical error to a wrong password, no cookie issued); no header / unknown / wrong-case header refused; refused attempts audited; a student session rejected on the staff portal and without the header; health and recovery stay reachable on both; production config refuses `PORTAL_ENFORCE=false`. `packages/shared/src/portal.test.ts`: the role↔portal map is exclusive for every role; the page allow-lists.

## Not covered by tests yet (do at rehearsal)

Two real hostnames in a browser: cookie never crosses; a staff cookie replayed to the student host; MFA enrolment flow on the staff portal; the Next process really answers 404 for the other portal's pages.
