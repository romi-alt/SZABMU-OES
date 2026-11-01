# 01 — Hosting capability audit (Hostinger Enterprise managed web hosting)

**Evidence labels** used in every document of this folder:
`[ACCOUNT]` read from the Hostinger account through the API connector, read-only · `[HOSTINGER-DOCS*]` taken from a web-search summary of Hostinger's support pages — the primary pages could **not** be opened from this session (`www.hostinger.com` is outside the session's network allow-list), so every such figure must be re-confirmed in hPanel · `[CODE]` read in this repository · `[CI]` produced by the project's CI · `[NOT VERIFIED]` could not be checked here.

Nothing was deployed, no DNS was changed, no migration was run, nothing on the Hostinger account was created, changed or deleted.

## The plan

| Item | Finding | Label |
|---|---|---|
| Product | **`cloud_enterprise_v3`**, status **active**, order created 2026-03-23. One hosting order on the account. | `[ACCOUNT]` |
| Websites on the order | **24**: 9 detected as Node.js, 14 "other" (PHP/static), 1 website-builder. `szabmu.site` is **not** one of them. | `[ACCOUNT]` |
| Node.js website limit | **10** for Cloud Enterprise (Business/Unlimited: 5) | `[HOSTINGER-DOCS*]` — confirm in hPanel |
| Node.js versions | **18, 20, 22, 24** (default 22; 20 and 22 marked LTS) | `[HOSTINGER-DOCS*]`, and the connector's build-settings schema accepts exactly `18, 20, 22, 24` `[ACCOUNT]` |
| Process limits | Cloud Enterprise NPROC **600** and entry processes **300** in one summary; "NPROC rising from 200 to 800 across cloud tiers" in another. **Conflicting.** Shared by all sites on the order. | `[HOSTINGER-DOCS*]` — confirm |
| CPU / RAM per plan | **Not obtained.** | `[NOT VERIFIED]` |
| Build resources | Builds run with higher limits than the running app; very long builds can fail | `[HOSTINGER-DOCS*]` |
| Request time limit | **120 s** per request, all plans | `[HOSTINGER-DOCS*]` |
| Inbound WebSockets | **Not supported** (outbound only) | `[HOSTINGER-DOCS*]` |
| Always-running workers / endless timers | **Not supported**; stop on deploy/restart. Cron recommended instead | `[HOSTINGER-DOCS*]` |
| Cron | Unlimited on Premium and above; the brief states a 30-minute run limit | `[HOSTINGER-DOCS*]` + brief |
| Deployment sources | GitHub (branch, root directory, build settings, env vars) and archive upload; Git deploy `type: nodejs` | `[ACCOUNT]` (connector `hosting_deploy`, `hosting_nodejs_update-build-settings`) |
| Settings per Node.js site | `node_version`, `app_type` (includes `next`, `nest`, `express`, …), `root_directory` ("where package.json is located"), `output_directory`, `build_script`, `entry_file` (**required** for nest/express/fastify), `package_manager` (npm/yarn/pnpm) | `[ACCOUNT]` |
| Environment variables | Set per site; **full replace** semantics; values masked on read; a Next.js build needs a **new build** to pick up build-time (`NEXT_PUBLIC_*`) values | `[ACCOUNT]` |
| Subdomains / HTTPS | Subdomains and parked domains are per-site objects; TLS is issued by the platform | `[ACCOUNT]` (operations exist) + `[HOSTINGER-DOCS*]` |
| External database connectivity | Outbound connections from the Node.js app are allowed in general; TLS to an external PostgreSQL has **not** been tested | `[NOT VERIFIED]` |

## Findings that change the design

1. **Node.js slots.** If the limit is 10 and 9 sites already use Node.js, **one** slot is free. This design needs **three** (student web, staff web, API). Either free slots (that means moving or removing other people's sites — not decided or touched here), or consolidate (doc 02, options B and C), or put the API on an external host. **Blocker B-01.**
2. **Node version.** The repository declares `engines.node >= 26` (`package.json`, `.nvmrc`, Dockerfiles, CI). Hostinger runs at most **24**. A CI job `node24` (this branch) installs, type-checks, lints, tests and builds on Node 24; until it is green there is no evidence the application runs on the platform's runtime. **Blocker B-02.**
3. **The platform cannot run the worker.** Doc 05. A separate always-on host is part of the design, not an option.
4. **The apex domain.** `szabmu.site`'s DNS zone is at Hostinger, but the domain is not attached to this hosting order and its apex `A` record points at an address that is not part of this account's evidence. Attaching `oes.` and `dashboard.` needs a documented hPanel flow decided at staging (doc 07). **Open question O-03.**
5. **Cloud Enterprise is a product name, not a capacity measurement.** No number of simultaneous candidates is claimed (doc `reliability-test-results.md`).

## What this document does not establish
CPU/RAM per site, whether the platform forwards request headers through Next.js rewrites, whether response streaming (SSE) survives the platform proxy, and the real process ceiling. Each is a staging test in doc 10.
