# 08 — Implementation checklist and release gates

Legend: ✅ done in this branch · ☐ not started · 👤 needs you · 🔒 behind a release gate (do not run before the gate).

## Done in this branch (local, non-destructive, default off)

| ✅ | What | Where |
|---|---|---|
| ✅ | Portal rules (role ↔ portal, page allow-lists) + tests | `packages/shared/src/portal.ts`, `portal.test.ts` |
| ✅ | `PORTAL_ENFORCE`: sign-in and per-request role↔portal check, audited, fail-closed; production config requires it | `apps/api/src/config.ts`, `modules/auth/auth.service.ts`, `common/auth.ts`; tests `test/portal.test.ts`, `test/config.test.ts` |
| ✅ | Web portal gate: with `PORTAL=student|staff` the process serves only its pages | `apps/web/src/proxy.ts` |
| ✅ | Production compose (Postgres + Redis private, API/web on loopback only), env templates, nginx vhosts for both subdomains | `infra/hostinger/` — compose validated with `docker compose config`; **nginx not validated (no nginx here)** |
| ✅ | Env/cert/backup paths git-ignored | `.gitignore` |

Not done and not claimed: any deployment, DNS change, production migration, SSH session, image build, nginx validation, load rehearsal on the VPS.

## Required changes still to make

### Backend
| ID | Change | Why |
|---|---|---|
| B1 | **First-admin bootstrap command** (refuses if a SUPER_ADMIN exists; temp password shown once; `mustChangePw`; audited) | G1 / R-03 |
| B2 | `Cache-Control: no-store` on every authenticated API response (Fastify `onSend` hook) | G5 / R-18 |
| B3 | SMTP authentication (`SMTP_USER`/`SMTP_PASS`, secure/STARTTLS options) **or** a relay container | G3 / R-04 |
| B4 | Require `Origin ∈ WEB_ORIGIN` on state-changing requests when `NODE_ENV=production` | G6 / R-17 |
| B5 | Cookie name `__Host-oes_session` in production (tests read the name via the constant) | G10 / R-02 |
| B6 | Fix or remove `npm run worker` (`dist/worker.js` does not exist) | G2 |
| B7 | Decide and implement the sign-in rate-limit policy for campus NAT (**owned by the other session**) | R-07 |
| B8 | MFA for every staff role (`MFA_ROLES`) if the policy says so | R-16 |

### Frontend
| ID | Change |
|---|---|
| F1 | Build-time/CI check that every route in `nav.ts` is allowed on its role's portal (`isPagePathAllowedOnPortal`) |
| F2 | Rehearsal check that `/dashboard` renders correctly for every role on its portal |
| F3 | Optional: Next `output: 'standalone'` for a much smaller web image (the current image copies the whole workspace) |

### Infrastructure
| ID | Change |
|---|---|
| I1 | CI job that builds both Docker images (R-13) |
| I2 | VPS bootstrap: updates, Docker + Compose plugin, nginx, certbot, ufw, chrony, unattended-upgrades, fail2ban (SSH) |
| I3 | Hostinger firewall group (80, 443 open; 22 from named IPs only) attached to the VPS |
| I4 | Backup schedule, encryption, off-box copy, restore drill (doc 06) |
| I5 | Monitoring: scrape `/api/metrics` locally, alert rules from `infra/observability/alerts.yml`, uptime check on `/api/health`, disk/cert alerts |
| I6 | Log rotation; SMTP relay + SPF/DKIM/DMARC |

## Release gates

| Gate | Passes when | Allowed after it |
|---|---|---|
| **G0 — prerequisites** | 👤 VPS reactivated; open questions in doc 01 answered; mail provider chosen; peak concurrency stated; policy items (MFA, staff-portal IP restriction, login-limit) decided | Start B/I work |
| **G1 — code ready** | B1–B6 merged, CI green incl. image build, `portal.test.ts` green, coordination with the other session (pinned release commit) | Build images |
| **G2 — rehearsal** 🔒 | On the VPS, under a **temporary hostname you control** (not `szabmu.site`): `nginx -t` passes; both portals work end to end; cookie never crosses hosts; wrong-portal sign-in refused; SSE works through nginx; offline→online save recovery; deadline auto-submit; **load rehearsal at the stated peak**; backup + restore drill passes; `GET /api/audit/verify` clean | Request the DNS gate |
| **G3 — DNS** 🔒 | G2 evidence reviewed by you; explicit approval | Add the four `oes`/`dashboard` records (doc 04), obtain certificates |
| **G4 — production data** 🔒 | Empty DB migrated on the pinned commit; first admin created; MFA enrolled for all required roles; reference data and real students loaded by campus admins | Real users sign in |
| **G5 — exam day** 🔒 | Backup just taken; reconciler healthy; alerts armed; named on-call; rollback and restore procedure printed | First real examination (start with a low-stakes pilot) |

## Recommended order

1. G0 (your actions) → 2. B1, B3, B5, B2, B4, B6 → 3. I1 → 4. I2, I3 (on the VPS, no public DNS) → 5. G1 → 6. rehearsal (G2) → 7. fix findings → 8. G3 → 9. G4 → 10. low-stakes pilot → 11. G5.

## Rules while this plan is executed

- No change to the exam engine's save/submit/lifecycle code as part of deployment work.
- No production migration, DNS edit or deploy without the gate above and your explicit instruction.
- Work that touches shared files follows `docs/COORDINATION.md`; Redis stays (it is part of the VPS design).
