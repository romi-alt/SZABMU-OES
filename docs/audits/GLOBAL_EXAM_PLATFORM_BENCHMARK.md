# Global examination platform benchmark — SZABMU OES (2026-11)

## How to read this
- **SZABMU maturity (0–5)** is scored from code and executed tests in this repository only:
  0 absent · 1 described, not implemented · 2 partial / untested · 3 implemented and tested locally · 4 tested on the production-like stack (MariaDB 11.8 CI, no Redis) · 5 proven in production use with monitoring.
  **No dimension is scored 5**: the platform has not run a real examination.
- **Benchmark capability** states what a leading product offers, with an evidence label:
  **[V]** vendor's own documentation · **[S]** secondary source (university IT/help pages describing the product) · **[M]** vendor marketing/brochure · **[—]** no source found in this audit.
  Vendor capabilities are *not* scored: no vendor product was tested, and nothing here claims SZABMU is better or worse than a product overall.
- Priority: P0 integrity/security · P1 operational · P2 quality · P3 innovation. Complexity: S / M / L.

## Sources consulted (2026-11-06)
- Inspera: product flyer (pcgacademia.pl, [M]); Inspera tech notes on offline backup (inspera.atlassian.net, [V]); UK G-Cloud listing ([M]); University of Zurich product brochure 2021 ([M]).
- ExamSoft/Examplify: university help pages (BU Questrom, SUNY Downstate, GMU Law) describing 60-second autosave, encrypted local backups, offline sitting and upload with e-mail confirmation ([S]).
- Questionmark: no official page reached in this audit; psychometric definitions (KR-20, point-biserial) from university item-analysis guides ([S], generic).
- TAO: taotesting.com marketing and case studies (QTI interoperability, PCI, CAT, LTI) ([M]); GitHub `oat-sa/package-tao` ([V]). **QTI 3.0 support not confirmed** by any source found.
- Safe Exam Browser: safeexambrowser.org developer pages on Config Key / Browser Exam Key and SEB Server glossary ([V]).
- Standards: OWASP ASVS 5.0, OWASP API Security Top 10 (2023), NIST SP 800-63-4, NIST AI RMF 1.0, OWASP Top 10 for LLM Applications, WCAG 2.2, 1EdTech QTI 3.0 — used as checklists, not as certification.

## Comparison matrix

| # | Dimension | SZABMU today (evidence) | Mat. | Benchmark capability | Gap | Impact | Recommendation | Pri | Cx |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Authentication security | argon2id, lockout, password policy+history, TOTP MFA with replay protection and recovery codes; parallel brute-force defects fixed in this audit (SEC-03/04/06/07) | 3 | SSO/SAML/OIDC with institutional IdP common in Inspera/Questionmark [M] | No institutional SSO; MFA not enforced on demo | Medium | Enforce MFA for privileged roles in production; evaluate university IdP | P1 | M |
| 2 | Role-based authorization | One permission per route, deny by default, generated route manifest, tests | 4 | Role/permission models standard [M] | — | — | Keep the structural test mandatory | — | — |
| 3 | Campus-level isolation | Query-level scoping, IDOR tests, 10-case campus suite | 4 | Org-unit scoping [M] | — | — | Keep | — | — |
| 4 | Student onboarding | Email-verified sign-up, one-time profile, self-declared placement blocked until verified | 3 | Usually roster/SIS import or SSO [M] | No SIS integration; SMTP not configured live | High for go-live | Configure SMTP; roster import is present for staff | P1 | S |
| 5 | Exam eligibility | Roster versions, enrolment eligibility, overrides with reason and audit, admission gate re-checked at start | 4 | Candidate registration/eligibility [M] | — | — | Keep | — | — |
| 6 | Scheduling & control | Explicit state machine (open/close admission, start, suspend, resume, extend, close, reconcile, score), idempotent commands | 4 | Live control in Inspera [M] | — | — | Keep | — | — |
| 7 | Question authoring | Single-best-answer MCQ and clinical MCQ with vignette, four-eyes review, versions, teacher pools, CSV import | 3 | Many item types, QTI import/export, collaborative authoring [M] | Only MCQ types; no images in items; no QTI | Medium (medicine needs images) | Add images to stems/options; consider QTI 3.0 export later | P2 | M |
| 8 | Question-bank security | Keys stored separately, never sent to students; course-scoped staff access | 3 | Encrypted item banks [—] | Keys in plaintext at rest (P-27) | Medium | Encrypt `correctLabel` at rest if policy requires | P2 | M |
| 9 | Paper generation | Manual assembly, approval freezes immutable snapshot | 3 | Blueprint/random-from-pool generation [M] | No blueprint-driven assembly | Low–Med | Blueprint assistant (Phase 8) | P3 | M |
| 10 | Randomization | Per-attempt seeded question order, stable across reloads | 3 | Question and option shuffling [M][S] | No option shuffling | Low | Option shuffle where semantically safe (exclude "all of the above") | P2 | S |
| 11 | Browser/device security | Event signals only (tab hidden, fullscreen exit), treated as weak evidence | 2 | Safe Exam Browser Config Key / Browser Exam Key verified by the server [V]; Examplify lockdown client [S] | No lockdown integration | High for high-stakes on-site exams | Optional SEB integration: verify `X-SafeExamBrowser-ConfigKeyHash` per exam | P1 | M |
| 12 | Session management | One active client per attempt, server-side sessions, revocation on deactivate/reset | 4 | — | — | — | Keep | — | — |
| 13 | Autosave reliability | Per-answer server commit with revision and journal; "Saved" only after commit | 4 | Examplify: local autosave every 60 s + encrypted backups [S]; Inspera online/offline backup [V] | No local encrypted backup — by design the server is authoritative | Low | Keep server-authoritative; consider encrypted local queue only for transport | P2 | M |
| 14 | Network interruption recovery | Queued answers shown as unconfirmed, resent; resume after reload | 3 | Full offline sitting (Examplify) [S], offline mode (Inspera) [M] | No full-offline sitting (needs a client app) | Medium on poor connectivity | Keep online model; measure campus connectivity | P2 | L |
| 15 | Concurrency stability | Row locks, idempotent seal, concurrent-submit tests; 1 000-candidate local load with integrity intact | 3 | Vendor claims of large scale (TAO Pro: 200k concurrent) [M] | Not load-tested on MariaDB/Hostinger | High | Load test 100/500/1 000 on a staging copy | P1 | M |
| 16 | Real-time monitoring | DB-derived snapshots, SSE with polling fallback, campus scoping | 3 | Live monitoring dashboards [M] | SSE untested on Hostinger edge (B-11) | Medium | Verify on staging; polling fallback exists | P1 | S |
| 17 | Incident management | Incidents with notes/status; open incidents block examiner approval | 3 | — [—] | — | — | Keep | — | — |
| 18 | Academic-integrity controls | Weak signals recorded, bounded (SEC-02); never automatic sanctions | 2 | SEB, proctoring add-ons [V][M] | No proctoring (needs policy) | Policy-dependent | Policy decision first | P3 | L |
| 19 | Submission reliability | Seal once, receipt code (HMAC), replay-safe, out-of-sync guard | 4 | Upload confirmation e-mail (Examplify) [S] | No receipt e-mail | Low | Optional receipt e-mail | P3 | S |
| 20 | Result accuracy | Deterministic scoring, negative marking, voids/key changes regrade, tests | 3 | — | — | — | Keep; add property tests | P2 | S |
| 21 | Result moderation | Lecturer review → examiner approval → publication by a different person | 4 | Moderation workflows [M] | — | — | Keep | — | — |
| 22 | Audit logs | Hash-chained, append-only (DB triggers), verify endpoint | 4 | — | IP in audit forgeable (SEC-08) | Medium | Fix proxy hop count | P1 | S |
| 23 | Accessibility | Keyboard palette, focus management; axe scans now running on 16 states | 3 | WCAG-conformance claims by vendors [M] | No manual screen-reader audit | Medium | Manual NVDA/VoiceOver pass of the exam journey | P1 | M |
| 24 | Student exam experience | Clear save state, palette, review screen, receipt | 3 | — | — | — | Usability test with students | P2 | M |
| 25 | Administration usability | Functional; several P2 findings open (A-04…A-11) | 2 | — | See UI_UX_FINDINGS | Low–Med | Work through tracker | P2 | M |
| 26 | Reporting & analytics | Exam reports, campus aggregates, CSV | 2 | Rich reporting [M] | — | Low | Add trend reports later | P3 | M |
| 27 | Psychometric analysis | p-value and distractor distribution, simple flags | 2 | Item statistics incl. discrimination, KR-20 (standard practice) [S] | No discrimination index, point-biserial or KR-20 | Medium (paper quality) | Implement deterministic item statistics with sample-size caveats (Phase 8 F5) | P2 | M |
| 28 | AI-assisted capabilities | None | 0 | AI authoring/marking features advertised by several vendors [M] | Everything | Optional | Governance first (docs/ai) | P3 | L |
| 29 | Infrastructure resilience | Works without Redis; auto-migrate; reconciler; one Node process | 2 | Multi-region SaaS [M] | Single process, shared hosting | High | Staging + restart/failover tests; capacity measurement | P1 | L |
| 30 | Scalability & performance | Local MariaDB measurement (this audit): 100/500/1 000 highly active candidates, 0 answers lost; latency degrades at 1 000 on one Node process (IMPLEMENTATION_TRACKER §2) | 2 | [M] | No measurement on current stack | High | Load test (tracker T-PERF-01) | P1 | M |
| 31 | Disaster recovery | Backup tool with restore verification exists | 2 | [M] | No restore drill on Hostinger MariaDB | High | Scheduled backups + drill | P1 | M |
| 32 | Operational readiness | Demo only; SMTP, MFA, portal enforcement off | 1 | — | Many | High | See PRODUCTION_READINESS_CHECKLIST | P1 | M |
| 33 | Interoperability (QTI) | None | 0 | QTI import/export (TAO) [M][V] | No QTI | Low now | QTI 3.0 export later | P3 | L |

## Summary
Strongest areas (score 4): authorization structure, campus isolation, eligibility, exam control state machine, session handling, autosave, submission, moderation and the audit chain.
Largest gaps relative to leading products: lockdown-browser integration (SEB), psychometrics, item media (images), measured capacity on the real hosting, disaster-recovery drills, and production configuration (SMTP, MFA, portal enforcement).
