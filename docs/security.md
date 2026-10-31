# Security model & test evidence

## Controls
| Area | Control |
| --- | --- |
| Authentication | Opaque 256-bit session tokens, stored only as SHA-256; `HttpOnly; SameSite=Lax` (+`Secure` in production) cookie; argon2id passwords; 5-failure lock (15 min) + per-IP/identity rate limits; identical errors for unknown user / wrong password (with dummy hash to equalise timing) |
| Recovery | Email OTP (6 digits, 10 min, 5 tries, hashed, single use) → single-use reset token → policy + 5-password history; all other sessions revoked |
| Authorization | Deny-by-default `@Perm`/`@Public` (structurally tested), shared role matrix, institution scope in every service query, four-eyes rules, out-of-scope ⇒ 404 |
| CSRF | Origin check on state-changing requests + SameSite cookies |
| Injection | Zod validation everywhere; Prisma parameterised queries; all raw SQL uses tagged templates (lint rule forbids `$queryRawUnsafe`); CSV export neutralises formula injection |
| Secrets | `loadConfig()` refuses dev secrets / `DEV_EXPOSE_CODES` in production; seed refuses to run in production |
| Data leakage | Answer key never sent to candidates (asserted in tests); errors return generic JSON (no SQL/stack); public certificate verify needs serial + code and returns masked name |
| Integrity | Append-only audit/answer journal and sealed-sheet trigger at DB level; hash-chained audit with verification endpoint |
| Headers | Helmet (API), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` (web) |

## Adversarial tests that exist and pass (`apps/api/test/security.test.ts`, `auth.test.ts`, `exam-engine.test.ts`)
Every route declares a permission · exact public-route allow-list · 401 when unauthenticated · role × endpoint 403 matrix (student, lecturer, invigilator, campus admin, examiner, CCE) ·
campus admin cannot read/create/modify/enrol/reset users or students in another campus (IDOR) · lecturer cannot read/edit another campus's questions ·
invigilator confined to assigned campus and cannot extend/force-submit/report for another campus · exam/roster/audit/CSV/report filtered by campus ·
privilege-escalation attempts (role minting, smuggled `role` field, scope widening) · four-eyes (question, paper, publication) ·
CSRF foreign-Origin rejection · SQL-metacharacter payloads in search/path/login · no SQL/stack in error output · hardening headers ·
CSV formula injection · students/campus admins cannot see unpublished results · credential-stuffing 429 · lockout · token tampering/expiry/logout replay ·
OTP guess limit · account-enumeration parity · cross-student attempt access (sheet/save/submit/receipt) · tamper detection of the audit chain.

## Not yet done (do before production)
- Independent penetration test; dependency audit in CI (`npm audit` currently reports advisories in transitive dev dependencies — not triaged).
- TLS termination, HSTS, secure cookie verification behind the real reverse proxy (`TRUST_PROXY`), WAF/rate limiting at the edge.
- Secrets management (vault), key rotation for `RECEIPT_SECRET`/`COOKIE_SECRET`.
- Backups/PITR and restore drills; DR runbook.
- Email deliverability (SPF/DKIM) for recovery codes; SMS/TOTP 2FA (policy P-04).
- Content-Security-Policy for the web app (Next inline scripts need nonce setup).
