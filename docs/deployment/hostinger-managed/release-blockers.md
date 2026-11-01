# Release blockers and final verdict

## Blockers (none closed)
| ID | Blocker | Needs | Owner |
|---|---|---|---|
| B-01 | Node.js slots: 3 needed, ~1 free (limit 10, 9 used — **unverified**) | confirm in hPanel; free slots by decision, or option B/C (doc 02) | account owner |
| B-02 | No proof the app builds/tests on **Node 24** (`engines >= 26`) | green `node24` CI job; then relax `engines` | me / CI |
| B-03 | External PostgreSQL, Redis, always-on worker host, monitoring not chosen or provisioned | decisions, accounts, costs (doc `infrastructure-dependencies.md`) | university/IT |
| B-04 | Portal binding on managed hosting undecided and not implemented (BFF-signed header vs Origin-based) | staging tests A-1/A-2, then implementation | me |
| B-05 | No first-administrator bootstrap for an empty production database | implement + test | me |
| B-06 | Client-IP trust through Hostinger edge → Next → API (rate limits/audit use a forgeable address) | hop-count setting or signed IP; test A-4 | me |
| B-07 | Student sign-up / e-mail verification / identity linking not implemented; needs a university policy | decision on authoritative attributes and roster owner; implementation | university + me |
| B-08 | Mail cannot authenticate to SMTP; no provider/SPF/DKIM/DMARC | relay or SMTP auth; domain mail records | IT + me |
| B-09 | Capacity unknown; CPU/RAM/process limits not obtained | staging load test; confirm limits in hPanel | me + account owner |
| B-10 | Backups: scheduled/encrypted/PITR/restore drill do not exist for the managed topology | provider PITR + tested restore | IT |
| B-11 | SSE behaviour on Hostinger untested (120 s request limit) | test A-3; fall back to polling-only (clients already poll every 8–10 s when the stream is down) | me |
| B-12 | Hostinger limits come from search summaries; primary pages unreadable from this session | confirm in hPanel / allow `www.hostinger.com` for the session | account owner |
| B-13 | Policy items open: MFA for LECTURER/INVIGILATOR; campus-NAT sign-in limit (60 per IP per 15 min) | university decision; the limit is owned by the other session | university |
| B-14 | Security: no penetration test; dependency advisories untriaged; answer keys stored in plaintext (P-27); secrets management; `__Host-` cookie and Origin-required changes pending | schedule review; implement | university + me |
| B-15 | University authorization for a live examination | written approval | university |

## Final verdict

**What can run on Hostinger Enterprise (design):** the student Next.js app, the staff Next.js app, the request/response API (`RUN_WORKERS=false`), and a finite reconcile cron — *if* slots, Node 24 and the staging tests allow.
**What must run on external services:** PostgreSQL (the engine requires it), Redis (recovery tokens, queues, events), an always-on worker (lifecycle reconciler and queue consumers), a mail relay, backup storage, monitoring, and eventually object storage.
**Implemented in this work:** worker entry (`worker.ts`), finite reconcile command with mail backstop, `PORT` handling for both apps, root build/start scripts, a Node 24 CI job, and the documentation. (Earlier, default-off: portal rules and `PORTAL_ENFORCE`.)
**Tested:** nothing in this session. CI on the pushed branch is the first evidence for builds and unit/API tests on Node 24; no hosted-topology test has been run.
**Blocked:** B-01 … B-15 above.
**Is a safe controlled pilot possible?** *Conditionally, and not yet.* A supervised, low-stakes pilot (small cohort, staff on duty, MANUAL control, worker or one-minute cron, synthetic-then-volunteer candidates) is **feasible in principle** because every guarantee that protects an acknowledged answer, a deadline and a single score lives in PostgreSQL and the API, not in Hostinger or Redis. It becomes possible only after B-01, B-02, B-03, B-04, B-05, B-06, B-08, B-10 and B-11 are closed and doc 10 passes. A university examination of any real consequence — and any figure of 5 000 or 20 000 simultaneous candidates — is **not** supported by the evidence and must not be claimed.
