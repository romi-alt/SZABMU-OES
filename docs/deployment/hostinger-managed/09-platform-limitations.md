# 09 — Platform limitations and how the design answers each

Labels as in doc 01. "HD*" = `[HOSTINGER-DOCS*]` (search summary of Hostinger's pages, unverified against the primary page).

| # | Limitation | Source | Effect on this system | Design answer | Residual risk |
|---|---|---|---|---|---|
| L1 | Node.js versions 18/20/22/24 only | HD*, `[ACCOUNT]` schema | repo declares `>=26` | run on **24**; CI job `node24`; relax `engines` only after it is green | unknown runtime differences until CI/staging |
| L2 | Node.js websites per plan: 10 (9 used) | HD*, `[ACCOUNT]` | three sites needed, one free | options B/C (doc 02) or the owner frees slots | **blocker B-01** |
| L3 | No always-running workers | HD* | lifecycle reconciler and queue consumers cannot live in a Hostinger site | external worker host (`start:worker`) + Hostinger cron backstop | an external dependency that must be paid for and monitored |
| L4 | 120 s request limit | HD* | any single request or **SSE connection** can be cut at 120 s | answer saves are millisecond requests; SSE reconnects with `Last-Event-ID` and replays from PostgreSQL; clients poll every 8–10 s while the stream is down (`openStream` users in `monitor`, `control`, exam lobby) | reconnect churn; polling load; **must be measured** |
| L5 | No inbound WebSockets | HD* | none — the code uses **SSE and HTTP only** `[CODE]` | none needed | — |
| L6 | No Redis, no PostgreSQL | `[ACCOUNT]` (MySQL only) | both are required | external managed services | latency, cost, availability of two more vendors |
| L7 | Shared process limit (NPROC) across all 24 sites | HD* (figures conflict) | other sites can starve the exam sites; Next + Nest + builds consume processes | confirm in hPanel; keep the API to one process; no cluster | unknown headroom; another tenant's spike affects exams |
| L8 | No configurable reverse proxy | brief | no per-path timeouts/buffering, no header injection, no IP allow-list | Next `rewrites` or BFF; rely on the platform for TLS | cannot tune SSE buffering; `X-Forwarded-For` semantics unknown (B-06) |
| L9 | Builds have resource limits | HD* | monorepo install + `next build` + `prisma generate` must fit | keep build commands per app; test at staging | build may need pre-built artefacts |
| L10 | Cron: existence and run limit; the brief states 30 min | HD* + brief | cannot provide second-level deadlines | backstop only (`cron-limitations.md`) | |
| L11 | Environment variables are full-replace and masked | `[ACCOUNT]` | an incomplete set deletes secrets | maintain the set in a controlled checklist; never copy masked values | operator error |
| L12 | CPU/RAM per site not obtained | `[NOT VERIFIED]` | capacity unknown | staging load test (doc 10, tests C-*) | cannot promise any concurrency |
| L13 | Data centre/region not obtained | `[NOT VERIFIED]` | DB and Redis placement | choose provider regions after the hPanel region is known | latency |
| L14 | The VPS the account owns is suspended | `[ACCOUNT]` | not used, per the brief | — | — |

## What "no VPS" means for the shape of the system
Three kinds of services must exist outside Hostinger: **PostgreSQL**, **Redis**, **an always-on worker**. The brief asks that this not be concealed: it is not a minor add-on, it is part of the production system, with its own cost, credentials, monitoring and on-call.
