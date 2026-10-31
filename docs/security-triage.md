# Dependency vulnerability triage

_Method: `npm audit` against the registry on 2026-10-31, then a decision per advisory group (runtime vs dev-only; reachable or not). Re-run on every dependency change; CI should fail on high/critical._

## Before → after
| | critical | high | moderate | total |
|---|---|---|---|---|
| Before triage | 2 | 2 | 13 | 17 |
| After | 0 | 0 | 11 | 11 |

## Actions taken
| Package (scope) | Advisories | Decision |
|---|---|---|
| `fastify` 5.11.3 → **5.12.7** (runtime, via `@nestjs/platform-fastify@11`; npm `overrides`) | schema/validation bypasses (body replacement, boolean schemas, header case, root-primitive coercion), auth bypass via malformed URLs reaching not-found handlers, HTTP/2 trailer DoS, **X-Forwarded-\* spoofing under `trustProxy` hop-count** | **Fixed.** The last one matters because production requires `TRUST_PROXY=true` (rate limits and audit use `req.ip`). We use zod, not Fastify schemas, so the schema-bypass issues were not directly reachable, but the not-found/URL one and trustProxy one were. Nest 12 (which would also fix it) was *not* adopted: unverified major. |
| `nodemailer` 7.0.13 → **10.3.1** (runtime) | ~28 advisories: SMTP command/header injection (CRLF), recipient-domain/address-parser bypasses (mail delivered to attacker-chosen domain), file-read/SSRF options, TLS-validation and cross-tenant credential disclosure, several DoS | **Fixed.** Our use is `createTransport`+`sendMail` with fixed options and zod-validated recipients, but password-reset mail goes to user-controlled addresses, so the address-parser bypasses were relevant. Also hardened: `requireTLS` in production (STARTTLS downgrade). |
| `vitest` 3.2.7 → **5.0.5** (dev/test only), `tinypool`, `@vitest/mocker` | prototype-pollution→RCE gadget, path traversal / code injection in mocking | **Fixed** (all 147 API + 15 shared tests pass unchanged). Was never shipped to production. |

## Accepted (documented, not fixed)
| Package | Advisory | Why accepted | Review by |
|---|---|---|---|
| `eslint` ≤ current, `@eslint/*`, `@eslint-community/eslint-utils`, `typescript-eslint` + `@typescript-eslint/*`, `minimatch` (11 moderate; **dev/lint tooling only, not in any runtime image**) | minimatch ReDoS via glob-part amplification | Only reachable through lint config globs that we author; no untrusted input; not installed in the production image (`npm ci --omit=dev`). The offered "fix" is `eslint@4.0.0` — a multi-major *downgrade* — so `npm audit fix --force` must NOT be run. Re-check when `typescript-eslint` ships a release depending on a patched `minimatch`. | next dependency review |

## Process gaps
- No automated gate yet: add `npm audit --omit=dev --audit-level=high` to CI (fails on runtime high/critical) and Dependabot/Renovate.
- Transitive runtime dependency tree not reviewed for licence or maintenance risk.
- `infra/Dockerfile.*` base images (node, postgres, redis, minio `:latest`) are unpinned and unscanned — pin by digest and scan (Trivy/Grype) before any shared environment.
- Lockfile integrity relies on the public registry; no private mirror or provenance checks.
