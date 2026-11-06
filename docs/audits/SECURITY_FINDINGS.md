# Security findings — 2026-11 full-system audit

Scope: `apps/api` (NestJS/Fastify, Prisma on MariaDB), `apps/web` (Next.js 16), `packages/shared`, deployment launcher. Method: code reading of every
authentication, authorization and exam-delivery path, then **a failing test written first** for each suspected defect, run against a disposable
MariaDB 10.11 (production: Hostinger MariaDB 11.8) without Redis (as on Hostinger). A finding is "Verified" only when its regression test fails
on the original code and passes on the fix. Nothing here was tested against the live site.

Severity: Critical (exam integrity/confidentiality broken for many users) · High (account takeover or bypass of a security control) ·
Medium (weakened control, needs extra conditions) · Low (hygiene, accuracy).

| ID | Severity | Title | Status |
|---|---|---|---|
| SEC-07 | **High** | Second factor (TOTP) brute-forceable with parallel requests | Verified fixed |
| SEC-06 | **High** | Sign-up email verification code brute-forceable with parallel requests (account creation on someone else's address) | Verified fixed |
| SEC-03 | Medium | Password-reset code: parallel guesses bypass the 5-guess limit | Verified fixed |
| SEC-04 | Medium | Password-reset codes can be re-minted without limit by rotating IP addresses | Verified fixed |
| SEC-01 | Medium | Session cookie issued without `Secure` on the HTTPS demo | Verified fixed |
| SEC-08 | Medium | Client IP taken from a forgeable `X-Forwarded-For` (`trustProxy: true`) | Open — needs the real proxy hop count on Hostinger |
| SEC-02 | Low | Integrity-event `detail` unbounded and events not rate-limited | Verified fixed |
| SEC-05 | Low | Password-reset audit entry records every actor as `STUDENT` | Verified fixed |
| SEC-09 | Low | Cached session (≤120 s) can outlive natural expiry | Open (accepted, documented) |
| SEC-10 | Info | Live demo runs the API with `NODE_ENV=development`, `PORTAL_ENFORCE`/`MFA_ENFORCE` off by design | Open — must change before any real exam |

Regression tests: `apps/api/test/audit-hardening.test.ts` (SEC-01…07). Run: `cd apps/api && npx vitest run test/audit-hardening.test.ts`.

---

## SEC-07 — Second factor brute-forceable with parallel requests (High)
- **Module:** authentication / MFA — `apps/api/src/modules/auth/mfa.service.ts` `verify`, `failure`, `assertNotLocked`.
- **Evidence:** `assertNotLocked` read `lockedUntil`, then the code was checked, then `failure()` read `failedLogins`, added 1 and wrote it back.
  There was no atomic per-account limit on `/auth/mfa/verify`. Test SEC-07 (40 parallel wrong codes from a session that holds the password)
  on the original code: **0 of 40 requests refused before verification**; concurrent read-then-write lost updates kept `failedLogins` below the lockout.
- **Reproduction:** sign in as an MFA-enrolled staff account (password known, device not) → send N parallel `POST /api/auth/mfa/verify {code}` with different codes; repeat bursts.
- **Root cause:** check-then-act on a counter without atomicity; no rate limit independent of the lockout.
- **Impact:** an attacker with a stolen password for SUPER_ADMIN/CCE/EXAMINER/CAMPUS_ADMIN could defeat the second factor (3 valid codes in 10⁶ per window, unlimited parallel bursts).
- **Fix (commit `fix(auth): cap second-factor attempts atomically…`):** atomic per-account cap (`kv.hit`, 10 attempts / 15 min) taken **before** any code is checked;
  failure count is an atomic `increment`; lockout set when the incremented value reaches 5 (also applied to password sign-in); an administrator MFA reset lifts the cap.
- **Verification:** SEC-07 passes (≥30 of 40 refused with 429 before verification, account locked, the correct code refused afterwards); `mfa.test.ts`, `auth.test.ts` pass.

## SEC-06 — Sign-up verification code brute-forceable (High)
- **Module:** student and teacher self-registration — `modules/auth/registration.service.ts` `verify`, `modules/teachers/teacher-registration.service.ts` `verify`.
- **Evidence:** the guess counter lived inside the pending JSON in the key-value store and was read, incremented and rewritten. Test SEC-06 on the original code:
  after **30 parallel wrong guesses from 30 addresses the correct code still created the account (HTTP 200)**. The only other control was 30 guesses/hour per IP.
- **Impact:** with rotating addresses an attacker could complete sign-up for an email they do not control (email ownership is the identity proof of this flow).
- **Fix:** guesses counted with an atomic increment (`reg:tries:<email>` / `treg:tries:<email>`) **before** comparing; a new code resets the counter.
- **Verification:** SEC-06 passes (correct code refused after the burst, no user created); normal sign-up with typos still works; `registration`, `onboarding`, `teachers` suites pass.

## SEC-03 — Reset code: parallel guesses bypass the 5-guess limit (Medium)
- **Module:** `modules/auth/auth.service.ts` `verifyCode`.
- **Evidence:** `attempts >= 5` was checked on a row read before the comparison; increments happened afterwards. Original code: 30 parallel wrong guesses → `attempts = 30` (all evaluated).
- **Fix:** conditional `UPDATE … SET attempts = attempts + 1 WHERE attempts < 5 AND usedAt IS NULL` consumes a guess before comparing; success marks the code used with a conditional update (single use under concurrency).
- **Verification:** SEC-03 passes (`attempts ≤ 5`, correct code refused afterwards).

## SEC-04 — Unlimited reset codes by rotating IPs (Medium)
- **Evidence:** the only limit was per `(email, ip)`. Original code: 14 requests from 14 addresses all returned 200.
- **Fix:** an additional per-address limit (10/hour), applied identically to unknown addresses so it does not reveal which accounts exist.
- **Verification:** SEC-04 passes for a known and an unknown address.

## SEC-01 — Session cookie without `Secure` on the HTTPS demo (Medium)
- **Module:** `modules/auth/auth.controller.ts`, `registration.controller.ts`; launcher `scripts/hostinger-single-site.mjs` (API created with `API_NODE_ENV`, default `development`).
- **Evidence:** `secure: cfg.NODE_ENV === 'production'`; the launcher documents that the demo API runs with `NODE_ENV=development` behind HTTPS.
- **Impact:** the session cookie could be sent over a plain-HTTP request to the same host (e.g. a downgraded or mistyped `http://` link) and observed on the network.
- **Fix:** `sessionCookieOptions()` (`common/auth.ts`): Secure when production, when the request is HTTPS (trusted proxy) or when every `WEB_ORIGIN` is https; logout clears with the same attributes.
- **Verification:** SEC-01 unit cases. **Not yet verified on the live site** (requires deployment approval).

## SEC-08 — Client IP from a forgeable header (Medium, open)
- **Module:** `apps/api/src/bootstrap.ts` `new FastifyAdapter({ trustProxy: cfg.TRUST_PROXY === 'true' })`.
- **Evidence:** with `trustProxy: true` Fastify trusts every hop and takes the left-most `X-Forwarded-For` value, which the client controls. Per-IP limits
  (`rl:login:ip`, `rl:reg:verify`, `rl:treg:verify`, `rl:forgot:<email>:<ip>`, public verify) and the IP written to the audit log can therefore be chosen by the caller.
  Already listed as release blocker B-06. **Mitigation added in this audit:** every brute-force-sensitive flow now also has a per-account atomic limit that does not use the IP (SEC-03/04/06/07; sign-in already had `rl:login:id`).
- **Proposed fix:** accept a hop count (`TRUST_PROXY=1|2`) and set it to the number of proxies Hostinger actually places in front of Node. Needs a measurement on the live host (send a known `X-Forwarded-For` and log what arrives) — **requires approval to deploy a diagnostic**.

## SEC-02 — Unbounded integrity-event detail, no rate limit (Low)
- **Evidence:** `eventDto.detail = z.record(z.string(), z.unknown())` (body limit 2 MB) stored verbatim in `attempt_events`; original code accepted a 5 000-character detail (HTTP 200).
- **Fix:** flat record, ≤10 keys, scalar values ≤200 chars; 60 events/min per attempt (in-process window). The player sends no detail, so nothing changes for students.
- **Verification:** SEC-02 passes, answers still save during throttling.

## SEC-05 — Wrong role in reset audit (Low)
- **Evidence:** `audit.log({ actor: { id, role: 'STUDENT' } … })` for every reset. **Fix:** the account's real role. **Verification:** SEC-05 (INVIGILATOR recorded).

## SEC-09 — Session cache can outlive expiry by ≤120 s (Low, accepted)
- `loadSession` caches the session for 120 s and is explicitly invalidated on logout, deactivation, password change and scope change; only *natural* expiry can lag by up to 120 s. Accepted; documented.

## SEC-10 — Demo security posture (Info)
- `docs/deployment/hostinger-demo/README.md` "Deviations": API `NODE_ENV=development`, two-portal enforcement and staff MFA not enforced, synthetic data only. These must be switched on, and SEC-08 resolved, before any real examination.

## Verified as sound (no defect found; evidence)
| Control | Evidence |
|---|---|
| Deny-by-default routing: every handler has exactly one `@Perm` or `@Public`; public set is fixed | `security.test.ts` (structural), `route-inventory.test.ts`, `docs/route-permissions.md` |
| Answer keys never reach students (snapshot has label+text only; `correctLabel` separate) | code `exams.service.ts:131`, `delivery.service.ts:43`; `key-confidentiality.test.ts` "no GET endpoint reachable by a student exposes key fields" |
| Object-level authorization on attempts (save, heartbeat, sheet, events, submit, receipt) | new `failure-scenarios.test.ts` #10 (all 404 for another student) |
| Campus isolation (lists, aggregates, CSV, monitor, institutionId manipulation) | `campus-isolation.test.ts` 1–10, `campus-monitor.test.ts` 30 |
| Teachers cannot reach results/grading/exams/student records | `teachers.test.ts` (role matrix + IDOR) |
| Results visible to students and campus admins only after publication; four-eyes publication | `workflow.test.ts` |
| CSRF: Origin allow-list on state-changing requests; cookie `httpOnly`, `SameSite=Lax` | `bootstrap.ts:17-22`; `security.test.ts` |
| CSV exports neutralise formula injection | `reports.service.ts:116`, teacher export |
| Hash-chained, append-only audit log (database triggers) | `workflow.test.ts` "is hash-chained, append-only at the database level, and tamper-evident" |
| TOTP replay protection (compare-and-set on `totpLastStep`) | `mfa.service.ts:81`, `mfa.test.ts` |

## Not covered by this audit (honest limits)
No external penetration test. Dependency advisories (`npm audit`, 2026-11-06): 7 moderate, 0 high, 0 critical — all in lint tooling
(`typescript-eslint` → `minimatch` ReDoS), none in a runtime dependency of the API or web server; to be cleared by a lint-tooling upgrade. no review of the Hostinger edge (TLS, HSTS, headers set by the platform); answer keys are stored in plaintext in the database (B-14/P-27); no secrets-management review beyond "not in git".
