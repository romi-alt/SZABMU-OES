# 11 — Security assessment

Scope: source review + live probes on a disposable stack + test suite (TODAY). No secrets are reproduced here. OWASP ASVS/Top-10 used as the checklist.

| Area | Assessment | Evidence |
|---|---|---|
| Authentication | argon2id; dummy-hash timing equalisation for unknown users (`auth.service.ts:19-49`); generic errors; password history; `mustChangePw` forced change; session token stored hashed (sha256), `httpOnly`, `sameSite=lax`, `secure` in production (`auth.controller.ts:25`) | `auth.test.ts`, e2e PASS |
| MFA | TOTP RFC 6238 (RFC vectors tested), seeds AES-256-GCM encrypted with `MFA_KEY`, replay CAS on last step, hashed recovery codes, enrolment forced for privileged roles with `MFA_ENFORCE`, pending sessions confined | `mfa.test.ts` 10 PASS; e2e spec PASS (enrol, then password-only sign-in lands on `/mfa`, URL-typing cannot skip) |
| Sessions | server-side rows, revoked on password change/MFA enrol (other sessions) | tests |
| Password recovery | 6-digit code, hashed, 5 attempts, expiry; code shown only with `DEV_EXPOSE_CODES` (config validation refuses it in production) | `config.test.ts` 22 PASS; e2e recovery PASS |
| RBAC | deny-by-default manifest: 98 routes, 7 public; permission matrix generated from `packages/shared` | `route-inventory.test.ts` 3 PASS |
| Campus / course isolation | see `09`; one MEDIUM finding (D-09) | live probes |
| Eligibility | server-side admission gate, frozen decision, audited overrides | 15 PASS |
| Answer-key confidentiality | no API returns keys to candidates/lecturers outside scope; sweep over every route's JSON for key leakage | `key-confidentiality.test.ts` 2 PASS. **Keys are plaintext in the DB** (P-27) |
| Result publication | separation of duties; unpublished invisible to students/campus (probes) | TODAY |
| Audit logging | hash-chained, append-only (trigger-enforced), verify endpoint; candidate lifecycle goes to `attempt_events` | tests; restored-backup chain verified |
| Input validation | zod on bodies/queries, UUID pipes, 2 MiB body limit | SOURCE |
| SQL injection | Prisma + tagged `$queryRaw` templates (parameterised); no string-built SQL found in `src/modules` | SOURCE; grep for `queryRawUnsafe/executeRawUnsafe/Prisma.raw` in `apps/api/src`: one hit, `seed/seed.ts:30` (dev-only TRUNCATE of table names read from the catalog; the seeder refuses production) — none in request paths |
| XSS | React escaping; grep for `dangerouslySetInnerHTML|innerHTML` in `apps/web/src`: 0 hits; **no CSP on the web app** | `next.config.mjs` |
| CSRF | SameSite=lax + Origin allow-list for unsafe methods (evil origin → 403, TODAY). Requests with no `Origin` header are allowed | `bootstrap.ts:19-23` |
| Rate limiting | login/forgot/save/verify; fail-open without Redis (P-28) | SOURCE; config doc |
| File uploads | none exist (S3 settings unused) | SOURCE |
| Security headers | API: helmet (HSTS, nosniff, XFO); web: XFO DENY, nosniff, Referrer-Policy; **no CSP, no HSTS at web tier** (expected at a TLS-terminating proxy that does not exist yet) | TODAY response headers |
| Dependencies | HISTORICAL triage: 17 → 11 advisories, 0 critical/high, all moderate dev tooling. **`npm audit` not re-run today** | `docs/security-triage.md` |
| Secrets / production config | `productionProblems()` refuses weak/default secrets, `DEV_EXPOSE_CODES`, localhost/`http` origins, missing metrics/MFA keys | `config.test.ts` |
| Debug / admin endpoints | none found; `/metrics` 404 without token | probes |
| Information leakage | out-of-scope → 404; uniform login error; one finding D-09 | probes |
| Privilege escalation | permission checked in guard *and* scope in service; role changes restricted (campus admin may create only students/lecturers/invigilators in own campuses) | tests |

## Findings

| ID | Sev | Finding | Location |
|---|---|---|---|
| S-1 | MEDIUM | Campus Admin can list all campuses with student/user counts (D-09) | `reports.service.ts:113-118` |
| S-2 | MEDIUM | No Content-Security-Policy on the web app; XSS has no second line of defence | `apps/web/next.config.mjs` |
| S-3 | MEDIUM | Answer keys plaintext at rest; any DB reader (or an unencrypted backup) obtains every key | policy P-27 |
| S-4 | MEDIUM | Backups are unencrypted, unscheduled and local; key/DB credentials handling for the script is undocumented beyond the runbook | `scripts/db-backup.mjs` |
| S-5 | LOW | Login/forgot rate limits fail open when Redis is unavailable; an attacker who can degrade Redis loses the throttle | P-28 |
| S-6 | LOW | CSRF defence trusts `Origin` presence; no token | `bootstrap.ts` |
| S-7 | LOW | Sessions/cookies rely on a single `COOKIE_SECRET`; rotation procedure not documented | config |
| S-8 | LOW | Temporary passwords are returned in API responses (shown once) and depend on the hand-off channel | `org.service.ts:89,131,158` |

No CRITICAL or HIGH finding was identified in the exercised surface. That is not an assurance: no independent penetration test, no fuzzing, no dependency re-scan today, no review of the Next.js server's own attack surface, no review of mail/SMTP handling, no WAF/TLS review (none deployed).
