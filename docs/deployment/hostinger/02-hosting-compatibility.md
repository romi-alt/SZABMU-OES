# 02 — Hosting compatibility

All Hostinger facts below were read through the Hostinger API connector **read-only** (VPS list, website list, DNS zone list). Nothing was created, changed or deleted. No SSH access or credentials were available or used.

## Evidence found

| Item | Finding |
|---|---|
| **VPS** | One exists: plan **KVM 4**, 4 vCPU, 16 GB RAM, 200 GB disk, Ubuntu 24.04 LTS (plain OS template, not a Docker template), IPv4 `168.231.82.140`, IPv6 `2a02:4780:28:fca1::1`, hostname `srv1719477.hstgr.cloud`, created 2026-05-31. |
| **VPS state** | **`suspended`.** Nothing can run on it until it is reactivated (billing/ownership action in hPanel, not possible from here). |
| Firewall | `firewall_group_id: null` — no Hostinger firewall group attached. |
| Docker / Compose on the VPS | **Unknown** (cannot query a suspended VPS). Ubuntu 24.04 template: assume neither is installed. |
| SSH | Unknown. Not assumed. |
| Other sites on the VPS | Unknown. |
| Backups / snapshots | Unknown (not queried). |
| Shared web hosting | A separate shared-hosting account (CloudLinux, Node.js capable) holds **24 unrelated sites**. `szabmu.site` is **not** among them. None of them may be touched. |
| DNS zone `szabmu.site` | Exists at Hostinger: `A @ → 2.57.91.91` (TTL 50) and `CNAME www → szabmu.site`. **No `oes` and no `dashboard` records.** The apex address is **not** the VPS address; who operates `2.57.91.91` is unknown. |

## Verdict: VPS, not web hosting

The application is four cooperating processes plus two data stores, not one Node.js web app:

| Needs | Why | Shared Node.js web hosting |
|---|---|---|
| PostgreSQL 16 | Authoritative store; integrity triggers, `SKIP LOCKED`, advisory locks, `ON CONFLICT … WHERE revision <` | **No.** Hostinger web hosting offers MySQL only. |
| Redis 7 | Rate limits, reset tokens, queues, live-event channel, heartbeats | **No** Redis service. |
| Long-running API + lifecycle reconciler | Auto-submit, grading, scoring must run while no one is browsing | Process lifetime/idle recycling is not under our control; the deadline reconciler is a correctness feature. |
| Node ≥ 26 | `engines` and Dockerfiles | Web hosting offers Node 18 / 20 / 22 / 24. |
| SSE for the live exam | Long-lived connections, buffering disabled | Fronted by a shared proxy we cannot configure. |
| Two portals × one API | Reverse-proxy header, per-hostname routing | Per-site only; no shared private service. |

**Chosen platform: the Hostinger VPS (KVM 4) running Docker Compose behind host nginx.** That is the only environment in the evidence that can run the existing services unchanged.

### If the VPS cannot be restored

A technically valid alternative exists but is not recommended: keep PostgreSQL and Redis on **external managed services** (provider TBD, TLS, private allow-listing), run the API on a **different** VPS or container host, and use Hostinger web hosting only for the two Next.js processes — which would first require lowering `engines` to Node 24 and verifying the build on it. That moves the exam-critical path across three providers. Prefer a new or restored VPS.

## Capacity (honest)

| Evidence | Value |
|---|---|
| Measured | 2,000 synthetic candidates × 50 questions: 100,000 acknowledged answers, 0 lost, on a **4 vCPU / 16 GB** machine running API + PostgreSQL + Redis + load generator together. The KVM 4 is the same class. |
| Not measured | Anything above 2,000; a real browser fleet; this VPS's disk and network; PostgreSQL tuned for it; two web processes alongside. |
| Single point of failure | One VPS = one host, one disk. Recovery depends on backups (doc 06) and on a rehearsed restore. |

**Rule:** plan for at most 2,000 simultaneous candidates per exam until a load rehearsal **on this VPS** (with `tests/load/exam-load.mjs`) passes, and decide the real expected concurrency before the release gate.

## Required infrastructure

- VPS reactivated; Ubuntu 24.04 updated; Docker Engine + Compose plugin; host nginx + certbot; `chrony`/systemd-timesyncd (deadlines use the database clock, but logs and TOTP need correct time).
- Hostinger firewall group: allow 80/tcp and 443/tcp from anywhere, 22/tcp **only from named admin addresses**; deny the rest. Same on the host (`ufw`).
- Postgres and Redis **never** published to any interface (the compose file publishes none; verified with `docker compose config`).
- Off-box encrypted backups (object storage or a second host).
