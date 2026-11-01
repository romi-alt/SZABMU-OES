# 07 — Security and Isolation

Method: source review + the existing 50-case adversarial suite (`security.test.ts`, re-run: pass). No live/intrusive testing. No secrets printed.

## Isolation
- Tenant context is derived from the authenticated session (`UserInstitution`), never from the browser. Handlers call `scope.filter/allows/assert`; out-of-scope reads return 404 (no existence oracle).
- Suite covers cross-campus read/write attempts for students, questions, exams, results, incidents, exports. **Runtime isolation: VERIFIED for the tested endpoints; NOT VERIFIED for endpoints added after the suite** → add an automated *route-inventory test* that fails if a controller handler lacks `@Perm`/`@Public` and a scope helper call (see roadmap).
- Gap: lecturer scope is institution-wide (no course assignment) → MEDIUM/HIGH authorisation weakness (a lecturer can author questions for any course of their institution; four-eyes still applies before approval).

## Findings
| Sev | Finding | Location | Mitigation |
|---|---|---|---|
| HIGH | No backup/restore, no incident logging pipeline, no alerting — confidentiality/availability of exam evidence unprotected operationally | infra | PITR, restore drill, log shipping |
| MEDIUM | No 2FA for privileged roles (CCE, Super Admin, Examiner) | auth | TOTP + recovery codes |
| MEDIUM | Web app sends no CSP; API helmet has CSP disabled | `next.config.mjs`, `bootstrap.ts:15` | strict CSP for web; keep API JSON-only |
| MEDIUM | Redis-backed rate limiter and session cache behaviour on Redis outage unknown (fail-open vs closed) | `redis.service.ts`, `auth.service.ts:38` | explicit tests; fail closed for login |
| MEDIUM | `npm audit` advisories untriaged; no SCA in CI | CI | triage, Dependabot |
| MEDIUM | Question-paper/correct-answer confidentiality at rest: snapshots with `correctLabel` live in plain PG rows; any DB reader sees keys | schema | column-level restriction (separate key table + role grants) or envelope encryption — policy decision |
| LOW | CSRF = Origin check + SameSite=Lax; requests with **no** Origin header pass the hook | `bootstrap.ts:20` | require Origin or custom header on mutating routes |
| LOW | Cookie `secure` only when `NODE_ENV=production`; relies on TLS termination config | `auth.controller.ts:24` | document + assert at boot |
| LOW | Account lockout permits targeted lock-out DoS of a student before an exam | `auth.service.ts` | add IP+account tiering, helpdesk unlock SOP |
| INFO | No file upload surface exists yet (no upload risk today) | – | design scanning/size/type limits before adding |

## Controls confirmed in code/tests
argon2id; opaque tokens hashed at rest; HttpOnly cookie; password policy + history; OTP attempt cap (5) and expiry; parameterised queries (lint bans `$queryRawUnsafe`); zod on inputs; CSV formula-injection guard; paper payload excludes keys (`exam-engine.test.ts:17`); production boot refuses `DEV_EXPOSE_CODES=true` (`config.ts:31`); audit hash-chain verification; masked public certificate verification; four-eyes rules.
