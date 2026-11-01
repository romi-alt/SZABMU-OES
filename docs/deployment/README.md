# Deployment documentation

| Folder | Target | Status |
|---|---|---|
| [`hostinger-managed/`](hostinger-managed/) | **Current plan.** Hostinger Cloud Enterprise managed Node.js hosting for `oes.szabmu.site` and `dashboard.szabmu.site`, with external PostgreSQL, Redis and an always-on worker. No VPS. | planning complete; **nothing deployed, nothing tested on the hosted topology**; read `release-blockers.md` first |
| [`hostinger/`](hostinger/) | Earlier plan for a self-managed Hostinger **VPS** (Docker Compose, nginx). | **Superseded** by the brief "no VPS". Kept for reference: its repository audit (doc 01) and risk register still apply; its infrastructure does not. The templates in `infra/hostinger/` belong to it. |

Evidence labels used throughout: `[ACCOUNT]` read from the Hostinger account, `[HOSTINGER-DOCS*]` search summary of Hostinger's pages (unverified), `[CODE]` read in the repository, `[CI]` produced by CI, `[NOT VERIFIED]`.
