# 07 — Domain configuration

Nothing here has been applied. **No DNS value is invented**: the records for a Hostinger-hosted site are the values hPanel displays when a domain is connected to that site.

## Observed `[ACCOUNT]`
- The DNS zone `szabmu.site` exists at Hostinger with only `A @ → 2.57.91.91` (TTL 50) and `CNAME www → szabmu.site`. No `oes`, `dashboard` or `api` records.
- `szabmu.site`, `oes.szabmu.site`, `dashboard.szabmu.site` and `api.szabmu.site` are **not** websites on the hosting order. So there is no existing website of another type to replace (the brief's stop condition does not trigger), and nothing to back up before adding them.
- The hosting order already uses temporary `*.hostingersite.com` domains for some sites — usable for staging.

## Public hostnames
| Hostname | Site | Public? |
|---|---|---|
| `oes.szabmu.site` | student Next.js | yes |
| `dashboard.szabmu.site` | staff Next.js | yes |
| `api.szabmu.site` (or the API site's temporary hostname) | shared API | **only because the web servers reach it over HTTPS**; no browser flow calls it; direct use is refused by the portal check (Mode 1) or limited to credentialed API clients. Not required if option C is chosen. |

An `api.` hostname is a **deployment option**, needed only when the API is a separate Hostinger site. It is not exposed to users and has no UI.

## hPanel steps (account owner, per site; repeat for each of the three)
1. hPanel → Websites → **Add website** → **Node.js web app** (do not touch the 24 existing sites; do not edit the root domain).
2. Connect **GitHub**, pick the repository and the pinned release branch.
3. Framework: Next.js (web) or NestJS (API). Node.js **24**. Package manager npm.
4. Root directory, build command, entry file: doc 03 (Config A first).
5. Environment variables: doc 08 (API site first; set secrets, then deploy).
6. Deploy; watch the build log; open the **temporary** hostname; check `/api/health` on the API site.
7. Only after staging passes (doc 10) and the release gate: connect the real subdomain to the site, add the DNS record **exactly as hPanel shows it**, wait for the platform's HTTPS issuance.
8. Verify with real observations: `dig +short`, `curl -sI https://…` (status, `strict-transport-security`, certificate subject and expiry), the cookie attributes in the browser.

## What must not change
The apex `szabmu.site` and `www` records and anything pointing them elsewhere; any existing hosted site; mail records of the domain (add SPF/DKIM/DMARC records for the chosen mail provider separately).

## Unknown until tried `[NOT VERIFIED]`
Whether a domain whose zone is on Hostinger but which is not yet a website on this order can be added as an addon/subdomain directly or must be added as a parent first; how hPanel presents the records to create; certificate issuance time. Record the observed behaviour in `10-staging-test-plan.md` results.
