# 07 — Risk register

Likelihood / impact: H, M, L. "Status" is as of this document.

| ID | Risk | L | I | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R-01 | **VPS is suspended**; nothing can be deployed or rehearsed | H | H | Reactivate/renew in hPanel; confirm plan and region | You | **Blocking** |
| R-02 | Apex `szabmu.site` resolves to `2.57.91.91`, not the VPS; unknown operator | M | M | Leave apex/www alone; add only `oes` and `dashboard` records; use `__Host-` cookie so a sibling cannot toss cookies | You / me | Open |
| R-03 | No way to create the first admin in production | H | H | Bootstrap command (B1) before rehearsal | Me | Not started |
| R-04 | Password recovery cannot send mail (no SMTP auth; no provider chosen) | H | H | Relay container or SMTP auth (B3); SPF/DKIM/DMARC; test delivery to real student addresses | You decide provider; me | Not started |
| R-05 | Wrong role on wrong portal | M | H | `PORTAL_ENFORCE` + nginx header overwrite + per-portal Next allow-list; tests in CI; production gate requires the flag | Me | Implemented, default off |
| R-06 | Forgotten `PORTAL_ENFORCE`/`X-OES-Portal` in nginx → API fails closed (everyone locked out) | M | M | Rehearsal checks both portals end to end; the API's production gate refuses `PORTAL_ENFORCE=false` | Me | Mitigated |
| R-07 | **Per-IP sign-in limit (60 / 15 min) throttles a whole campus behind one NAT at exam start** | H | H | Decision needed: staggered entry window, a per-institution allowance for known campus egress IPs, or account-only limiting; production currently refuses any other value (`productionProblems`) | You (policy) + other session (owns the limit) | **Open, unowned** |
| R-08 | Capacity above 2,000 concurrent unproven; real peak unknown | M | H | State the expected peak; run `tests/load` against this VPS; cap admission until proven | You / me | Open |
| R-09 | Single VPS = single point of failure | M | H | Verified restore drill, documented RTO, spare-VPS procedure; accept or fund a second node | You | Open |
| R-10 | Backups unscheduled, unencrypted, no PITR, never restored at scale | H | H | doc 06 plan; no real exam before a successful restore drill | Me | Not started |
| R-11 | SSE or save traffic broken by proxy buffering/caching | M | H | Templates unbuffer SSE, no proxy cache, no `limit_req` on saves; test with a real exam rehearsal and an offline/online toggle | Me | Templates written, **nginx not validated here** |
| R-12 | nginx templates never ran `nginx -t` (no nginx available in the sandbox) | H | M | Gate G2: `nginx -t` on the VPS before reload | Me | Open |
| R-13 | Docker images never built in CI; Node 26 base image behaviour untested | M | M | Add image build to CI (B6); build on the VPS only after that | Me | Not started |
| R-14 | Secrets handling: env files on the VPS, no vault, no rotation | M | H | Files mode 600, git-ignored (`infra/hostinger/env/*.env`), generated on the VPS; rotation procedure written before go-live | Me | Templates only |
| R-15 | Redis down or flushed | L | M | By design degrades latency/monitoring, not correctness; reset tokens are lost on flush (users re-request) | — | Accepted |
| R-16 | MFA not required for LECTURER/INVIGILATOR on the staff portal | M | M | Policy: require MFA for all staff roles (one-line change to `MFA_ROLES`) | You | Decision pending |
| R-17 | CSRF check accepts requests with no Origin | L | M | Require Origin on state-changing requests in production (B4); `SameSite=Lax` compensates today | Me | Not started |
| R-18 | Authenticated API responses lack `Cache-Control: no-store` | L | M | nginx adds it; API should too (B2) | Me | nginx done, API not |
| R-19 | Concurrent sessions editing the same repo (foundation moved 3× during planning) | H | M | `docs/COORDINATION.md`; pin a release commit; rehearse on it | Both | Mitigated |
| R-20 | Answer keys stored in plaintext (P-27); no independent penetration test; dependency advisories untriaged | M | H | Out of scope of deployment but **blocks a real high-stakes exam**; schedule before pilot | You | Open |
| R-21 | Disk, log and certificate lifecycle (full disk, expired cert) | M | M | Disk alert, log rotation, certbot timer + expiry alert | Me | Not started |
| R-22 | Clock drift (TOTP, logs) | L | L | `chrony`/timesyncd; deadlines use the database clock | Me | Planned |
| R-23 | Shared web-hosting account (24 unrelated sites) touched by mistake | L | H | None of this plan uses it; no credentials for it are needed | — | Mitigated |
| R-24 | Staff portal exposed to the whole internet | M | M | Decide: IP allow-list/VPN for `dashboard.` (nginx `allow`/`deny` or Hostinger firewall) | You | Decision pending |
