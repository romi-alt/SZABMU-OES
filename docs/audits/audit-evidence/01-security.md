> Evidence file for `docs/audits/SZABMU-OES-INFRASTRUCTURE-AND-AI-READINESS-AUDIT.md` (2026-11-07). Produced by static, read-only code review; nothing was executed. Each finding is tagged VERIFIED (code read at the cited line) or ASSUMPTION. Findings in the main report marked "re-checked" were additionally confirmed by the lead auditor.

# SZABMU OES - Security and Access Control Audit (read-only review)

Scope: apps/api/src (common, auth, audit, org, teachers, exams, delivery, control, results, reports, invigilation, directory, infra, config, bootstrap, main), apps/web/src (proxy.ts, csp.ts, session.tsx, api.ts), packages/shared (permissions, roles, password, links), apps/api/prisma/migrations (triggers), infra/hostinger (nginx, env examples), scripts/hostinger-single-site.mjs.
Method: source reading only. Nothing was run, no server started, no database touched. Docs were treated as claims. Tags: VERIFIED = I read the code that proves it; ASSUMPTION = depends on deployment or behaviour I could not observe.

Severity counts: CRITICAL 0 | HIGH 1 | MEDIUM 5 | LOW 11 | INFORMATIONAL 3  (20 findings)

---------------------------------------------------------------------------------------------------

## Findings

### SEC-01 - HIGH (conditional) - Demo posture bypasses every production guard; public demo password; MFA and portal separation off
- Where: scripts/hostinger-single-site.mjs:25 (`process.env.NODE_ENV = process.env.API_NODE_ENV || 'development'`); apps/api/src/config.ts:62-87 (`productionProblems` runs only when NODE_ENV === 'production', config.ts:97-102); apps/api/src/seed/seed.ts:14 (`DEMO_PASSWORD = '<published demo password>'`); README.md:24 and PROJECT.md:74 publish the password and the account names (super.admin, cce, examiner ...).
- Evidence: the launcher intentionally starts the API in `development` so `MFA_ENFORCE`, `PORTAL_ENFORCE`, secret-strength, `TRUST_PROXY`, TLS-to-DB and METRICS_TOKEN checks are not enforced. Defaults are `MFA_ENFORCE=false`, `PORTAL_ENFORCE=false`, `TRUST_PROXY=false` (config.ts:38-48). docs/audits/SECURITY_FINDINGS.md SEC-10 admits this ("must change before any real exam").
- Impact: on any host started this way, the seeded SUPER_ADMIN/CCE/EXAMINER accounts are logged into with a password that is in the public repo, with no second factor and no student/staff portal split. If real data or a real exam is ever placed on that deployment, it is a full compromise. Harmless only while the site is truly synthetic.
- Recommendation: make the launcher refuse to start (or refuse to seed) when `API_NODE_ENV != production` and the DB contains non-demo rows; never ship the seeded DB and a real DB on the same host; rotate/disable demo accounts before go-live; add a startup banner and a CI check that a "real exam" deployment has MFA_ENFORCE/PORTAL_ENFORCE true.
- Tag: VERIFIED (code); ASSUMPTION (what is deployed on szabmu.site today).

### SEC-02 - MEDIUM - Full paper and answer key readable by LECTURER (and any question.read role) at any time after authoring, including while the exam is LIVE; reads are not audited
- Where: GET /api/exams/:id/paper -> apps/api/src/modules/exams/exams.controller.ts:46 (`@Perm('question.read')`, `exams.paper(u,id,true)`), exams.service.ts:78-82 (includes `isCorrect` for every option, no exam-status condition); GET /api/grading/exams/:id/analysis -> results.service.ts:62-96 (returns `stem` + `key: q.correctLabel` + distributions, no status condition; `grading.review` includes LECTURER, permissions.ts:45); GET /api/questions and /questions/:id return `correct` / isCorrect (questions.service.ts:60-75).
- Evidence: the only restriction for a LECTURER is `access.assertExam` (an ACTIVE assignment to the course at a participating campus). No time/status gate, no "exam has started" lock, and no audit record for these read paths (audit.log is only called on writes).
- Impact: a lecturer who teaches the cohort can obtain the approved paper and key from the moment the paper is approved until after the sitting, with no trace. Examiner/CCE/SUPER_ADMIN can do the same (by design, but also untraced). Confidentiality of the key therefore rests entirely on people, not controls. (Candidate-facing endpoints are clean - see "Controls verified".) Note: itemAnalysis throws a TypeError (HTTP 500) for exams whose paper is not yet approved because `q.snapshot` is null (results.service.ts:95), so exposure starts at paper approval.
- Recommendation: after paper approval restrict full-paper/key reads to EXAMINER/CCE (or a named "paper custodian"), block LECTURER reads from APPROVED until PUBLISHED/after close, and write an audit entry for every paper/key read (`paper.read`, `analysis.read`); consider watermarking/printing logs.
- Tag: VERIFIED.

### SEC-03 - MEDIUM - Result integrity: separation of duties incomplete and no DB-level immutability for results, keys or key actions
- Where: results.service.ts:100-113 (`keyAction`: VOID/CHANGE_KEY, no second approver), :116-133 (lecturer review / examiner approve), :135-153 (`publish` only requires publisher != examiner-approver, :139); permissions.ts:45-49: SUPER_ADMIN holds grading.review + grading.keyaction + result.approve_examiner. Migrations: apps/api/prisma/migrations/20261104000000_mysql_baseline/migration.sql:902-948 and 20261106100000_*:69-72 define triggers only for audit_logs, answer_events, exam_roster_versions, eligibility_overrides, attempt_answers (post-seal), exam_events, question_versions. There is no trigger or constraint on `results`, `result_batches`, `key_actions`, `exam_questions.correctLabel/snapshot`, `attempts` (receiptCode, answerDigest), `attempt_events`.
- Evidence: a single SUPER_ADMIN can change a key, mark lecturer review, and examiner-approve; only the CCE publish step needs a different person, and nothing requires the person who changed a key to differ from the approver. After PUBLISHED the API has no endpoint that edits marks (verified: no PATCH/PUT on results; `keyAction` rejects once the exam/batch is approved/published, :102), so application-level immutability is sound, but a direct SQL change (compromised app account, DBA, SQL error) is not detected: `results.percent/status` can be rewritten silently, and the audit chain does not contain the score.
- Impact: insider or DB-level result manipulation after approval would not be blocked or detected; key corrections lack dual control.
- Recommendation: (1) require approval of CHANGE_KEY/VOID by a second EXAMINER/CCE who is not the requester; (2) forbid one user performing more than one of review/key-action/approve on an exam; (3) add BEFORE UPDATE/DELETE triggers on results, key_actions, exam_questions (once approved) and attempts' sealed columns when the batch is PUBLISHED; (4) include a result-set digest (hash of all result rows) in the publish audit entry.
- Tag: VERIFIED.

### SEC-04 - MEDIUM - Audit chain is tamper-evident only against naive edits (unkeyed hash, no external anchor, tail deletion undetectable, silently partial verification)
- Where: apps/api/src/modules/audit/audit.service.ts:46-72; triggers migration.sql:902-905.
- Evidence: hash = SHA-256 over (prevHash, at, actor, action, entity, entityId, institutionId, meta) with no secret key (HMAC) and no off-database anchor. Anyone with write access to the DB who can drop the two triggers (the application DB user also runs migrations via scripts/auto-migrate.mjs at launcher start - ASSUMPTION that it is the same account) can edit rows and recompute the whole chain; deleting the newest N rows leaves a valid chain. `ip`, `actorRole`, `seq` are not in the hash. `verifyChain(limit = 100000)` (audit.service.ts:62-63) takes the first 100 000 rows and returns `{checked, brokenAt:null}` without saying the chain is longer, so a larger log is only partially verified. A SUPER_ADMIN cannot delete via the API (no delete route; verified) - that part of the claim in docs/security.md is true.
- Impact: forensic value of the log is limited against a privileged insider/DBA.
- Recommendation: HMAC the chain with a key not stored in the DB (or periodically publish the head hash to an external WORM store/e-mail); verify in pages and report `totalRows`; give the app DB user no TRIGGER/DROP privilege after migration (separate migration account); include ip and actorRole in the hash.
- Tag: VERIFIED (code); ASSUMPTION (DB account privileges).

### SEC-05 - MEDIUM - Rate limits and attempt caps fail open when the coordination store errors
- Where: apps/api/src/infra/kv.service.ts:54-59 (`safe()` returns the fallback `0` on any error; for Redis it also opens a 3 s circuit breaker, `commandTimeout: 500`, :44) and :77-92 (`hit()` returns 0 on failure). Consumers: auth.service.ts:45-46 (login IP and account limits), :152-155 (forgot), mfa.service.ts:46 (`rl:mfa:` cap), registration.service.ts:38,69,74 (sign-up code guesses), teacher-registration.service.ts:100,128,133, results.controller.ts (public verify).
- Evidence: a Redis outage or a 500 ms command timeout under exam-day load makes every `kv.hit()` return 0, i.e. "allowed", for login, OTP request, OTP guess counting (`reg:tries`, `treg:tries`) and the MFA attempt cap. The DB-backed account lockout (failedLogins >= 5) and password-reset `attempts` column still hold, but the sign-up OTP and MFA parallel-burst protections described as fixed in SECURITY_FINDINGS SEC-06/SEC-07 depend on `kv.hit`.
- Impact: an attacker who can degrade or time out Redis (or who simply times attacks to load spikes) disables the brute-force controls added in the last audit; the 6-digit sign-up code (identity proof for an e-mail) becomes guessable again with parallel requests.
- Recommendation: fail closed (429) for security-sensitive counters when the store is unavailable, or fall back to the DB counter (as the database backend already does); alert on `kv` breaker open.
- Tag: VERIFIED.

### SEC-06 - MEDIUM - MFA covers only four roles; key- and exam-control-capable roles are password-only; first-come enrolment
- Where: apps/api/src/common/auth.ts:25 (`MFA_ROLES = SUPER_ADMIN, CCE, EXAMINER, CAMPUS_ADMIN`); config.ts:47 default `MFA_ENFORCE=false`; mfa.service.ts:52-70.
- Evidence: INVIGILATOR (force-submit and extend any attempt on their campus, permissions.ts:41), LECTURER (answer keys per SEC-02, results scoped, permissions.ts:25,47) and TEACHER (authors content) have no second factor. An account in state `enroll` may bind the first TOTP seed with only the password (`AllowMfaPending` on /auth/mfa/setup + /enable); a stolen temp password for a freshly provisioned privileged account, or an account just reset by `mfa/reset/:userId`, lets the attacker bind their own authenticator before the owner.
- Impact: password compromise of a lecturer or invigilator reaches key material and exam-disruption powers without MFA.
- Recommendation: add LECTURER and INVIGILATOR (and TEACHER at least for submission) to MFA_ROLES; deliver the initial enrolment through an admin-issued one-time enrolment code or require the temp password change plus e-mail confirmation before `setup`.
- Tag: VERIFIED.

### SEC-07 - LOW - TEACHER (including PENDING, REJECTED, SUSPENDED teachers) receives university-wide totals from GET /api/dashboard
- Where: apps/api/src/modules/reports/reports.service.ts:12-90 (`switch (u.role)`: STUDENT, LECTURER, EXAMINER, CAMPUS_ADMIN, INVIGILATOR, CCE, then `default:`); route reports.controller.ts:16 is `@Perm('program.read')`, and `program.read` includes TEACHER (permissions.ts:15). `me()` filters a non-approved teacher down to `teacher.self`+`program.read` (auth.service.ts:~120) but the dashboard route only checks `program.read`.
- Evidence: TEACHER falls into `default`, which returns `{institutions, users, students, exams, auditEntries}` for the whole university (demo rows excluded unless visible). The regression test that is meant to cover teacher access probes `/reports/dashboard` (apps/api/test/teachers.test.ts:243), a path that does not exist (the route is `/dashboard`), so the gap is not caught.
- Impact: a self-registered teacher with only a verified e-mail can read aggregate counts of users, students, exams and audit entries. Aggregates only, no PII or marks.
- Recommendation: add an explicit `case 'TEACHER'` (own-bank counts) and make `default` return `{}`/403; fix the test URL.
- Tag: VERIFIED (code reading; not executed).

### SEC-08 - LOW - A campus administrator of any one campus can approve/reject/suspend/reinstate a teacher's whole account
- Where: apps/api/src/modules/teachers/teacher-admin.service.ts:25-29 (`load` passes if ANY assignment is in the admin's scope), :63-99 (`decide`, `suspend`, `reinstate` update the single `teacherProfile.status` and revoke sessions).
- Evidence: the profile status is global; a teacher with assignments at campuses A and B can be suspended by the admin of B alone, which removes access at A too (and `reinstate` by B re-enables A).
- Impact: cross-campus authority over account state (availability/authority, not data disclosure).
- Recommendation: restrict account-level decisions to SUPER_ADMIN (or require all campuses), allow campus admins only per-assignment decisions in their campus.
- Tag: VERIFIED.

### SEC-09 - LOW - Login account-lock and per-account limit allow cheap lock-out of any known account; lock state is distinguishable
- Where: auth.service.ts:44-60 (per-account `rl:login:id:${email}` 20 attempts/15 min and 5-failure lock for 15 min), :50-54 (HTTP 423 ACCOUNT_LOCKED vs 401 INVALID_CREDENTIALS).
- Evidence: anyone knowing a staff/student e-mail can submit 5 wrong passwords and keep the account locked; the 423 reveals the account exists. The same counter increments for successful logins (rate limit counts every request). docs/security.md claims identical errors for unknown vs wrong password - true except for locked accounts.
- Impact: targeted denial of access (e.g. to a student minutes before an exam) and an account-existence oracle for accounts that are locked. /auth/forgot response is uniform, but the existing-user path does DB writes + mail enqueue, so response time differs (timing oracle).
- Recommendation: lock by (account, IP/device) with exponential back-off or CAPTCHA/step-up instead of a hard per-account lock for students; return 401 with a generic message and deliver the lock notice by e-mail; equalise the forgot path timing.
- Tag: VERIFIED.

### SEC-10 - LOW - CSRF defence is an Origin check that is skipped when no Origin header is sent; no token; cookie lacks __Host- prefix
- Where: apps/api/src/bootstrap.ts:17-22 (`if (origin && !allowed.includes(origin)) -> 403`), common/auth.ts:35-40 (cookie `oes_session`, HttpOnly, SameSite=Lax, Secure when https/production).
- Evidence: requests without Origin pass. With SameSite=Lax, browsers do not attach the cookie to cross-site POST/PUT/PATCH/DELETE, and fetch/XHR always send Origin on cross-origin, so exploitation needs a same-site attacker (a sibling subdomain of the cookie's site) or a client that omits Origin. There is no CORS plugin (API is same-origin via the Next rewrite and nginx), which is good. SSE and GET routes are read-only.
- Impact: low; defence in depth only.
- Recommendation: also require `Sec-Fetch-Site: same-origin|same-site` or a custom header (e.g. X-Requested-With) on state-changing requests; use the `__Host-` cookie prefix (path=/, Secure, no Domain - already compatible).
- Tag: VERIFIED.

### SEC-11 - LOW - Unauthenticated actions write permanent, append-only audit rows serialised on one global lock
- Where: auth.service.ts:70-75 (`auth.login_failed` with attacker-supplied e-mail in `meta`), registration.service.ts:47,61 (`auth.register_unavailable`, `auth.register_requested`); audit.service.ts:47 (`SELECT ... FROM app_locks WHERE name='audit_chain' FOR UPDATE`).
- Evidence: every failed login writes a chain row. Rows cannot be deleted (triggers), so the table grows with attacker traffic; throughput is bounded by the single chain lock, which exam-control commands also hold inside their transactions (control/transition.ts, `audit.append` in tx). IP limits (60/15 min) are per client IP and TRUST_PROXY must be set correctly (SEC-08 in the previous audit).
- Impact: log flooding and lock contention (availability) during an exam; forensic noise.
- Recommendation: count failed logins in `kv`/metrics and write an audit row only on the lock transition or first failure per window; keep the chain for privileged and state-changing actions.
- Tag: VERIFIED (contention is ASSUMPTION - not measured).

### SEC-12 - LOW - Live SSE streams are not re-authorised after connect; some events carry other candidates' ids
- Where: control/control.controller.ts:96-122 (authorisation once in the guard, then `reply.hijack()` and a long-lived write loop); control.service.ts:194,259 (`sel` omitted when > 500 candidates), events.service.ts:20-26 (`visibleTo`).
- Evidence: a session revoked by logout/deactivation/password change keeps receiving events until the socket closes (per-user cap of 4 streams limits abuse). For a CANDIDATES-scope suspension/extension, the payload contains `studentIds` (up to 500 internal student UUIDs) delivered to each affected student, and above 500 ids the list is omitted so the event is delivered to every candidate of the exam (clients treat events as hints and re-read state, so no state leak).
- Impact: minor information disclosure (internal UUIDs of co-affected candidates; "exam suspended" hints), delayed revocation.
- Recommendation: strip `studentIds` from the payload delivered to students; periodically re-check `sess:` on the stream and close on revoke; always set a studentId filter server-side instead of omitting it.
- Tag: VERIFIED.

### SEC-13 - LOW - DB TLS check accepts unverified TLS; example production env is stale
- Where: apps/api/src/infra/db-url.ts:24-26 (`dbUrlRequiresTls` returns true for `sslaccept=accept_invalid_certs` and `sslmode=require`, and :32-35 maps `require` -> `accept_invalid_certs`); config.ts productionProblems message says "sslaccept=strict". infra/hostinger/env/api.env.example uses `postgresql://...sslmode=require`, which `poolConfigFromUrl` rejects (db-url.ts:30) - the template would fail at boot.
- Impact: a production config can pass validation with an encrypted but unauthenticated DB link (MITM on the DB network); stale template invites ad-hoc fixes.
- Recommendation: in production require `sslaccept=strict`; refresh the env examples to the MariaDB reality.
- Tag: VERIFIED.

### SEC-14 - LOW - One-time codes are stored in clear text in outbound_messages and never purged
- Where: auth.service.ts:155-157 (reset code in mail body), registration.service.ts:57, teacher-registration.service.ts:116; infra/mail.service.ts:30-66 (row kept after SENT, `body` never cleared; in outbox-only mode with no SMTP_HOST the row stays PENDING).
- Impact: anyone with DB read (backup, replica, SQL console) sees reset/registration codes; valid for 10-15 min, so mostly relevant in outbox-only demo mode and for backups taken during the window. There is no API route that lists the outbox (verified).
- Recommendation: blank `body` when status becomes SENT (or store only a template id and render at send time), and purge old rows.
- Tag: VERIFIED.

### SEC-15 - LOW - Student self-sign-up can squat a registration number or e-mail
- Where: registration.service.ts:36-50 (anyone can claim an unclaimed regNo; the real student then gets ALREADY_REGISTERED), onboarding.service.ts:60-78 (profile created `selfDeclared: true`).
- Evidence: containment works - a self-declared student cannot be enrolled (org.service.ts:285 `selfDeclared: false`), cannot be rostered (exams.service.ts:164) and cannot start an exam (delivery.service.ts:117 `ACADEMIC_UNVERIFIED`). Residual risk: denial of registration to the real owner, and a campus admin who "verifies" without checking identity (`updateStudent verify:true`, org.service.ts:266-273) converts an impostor into a real candidate.
- Recommendation: matching verification against the official roster (`roster_entries`, DOB) before verify, a visible "claimed by" workflow, and an admin tool to release a squatted regNo (and audit it).
- Tag: VERIFIED.

### SEC-16 - LOW - Insider abuse bounds for time and incident data
- Where: invigilation.controller.ts:16 (`minutes` 1-60 per call, unlimited calls); exams.controller.ts:61 (campus admin accommodation up to 120 extra minutes, no second approval, exams.service.ts:233-239 does not require the exam to be in a particular state); invigilation.service.ts:~106 `report()` accepts an unvalidated `studentId` (only `attemptId` is checked).
- Impact: a colluding invigilator/campus admin can grant extra time or force-submit (all audited, campus-scoped, reason required). Incident can reference a student UUID from another campus (no data returned).
- Recommendation: cap total extension per attempt without CCE approval and alert on > N; validate `studentId` belongs to the exam/campus.
- Tag: VERIFIED.

### SEC-17 - LOW - Teacher view reveals which of their questions are on frozen exam papers
- Where: teacher.service.ts:313-320 (`usedInExams`), :323-340 (`versions`).
- Impact: metadata about exam composition (which authored question is on an approved paper) for a self-registered author. No question text from other authors, no marks.
- Recommendation: show "used" only after the exam is PUBLISHED, or not at all.
- Tag: VERIFIED.

### SEC-18 - INFORMATIONAL - Public health endpoint and edge coverage
- /api/health is @Public (health.controller.ts:9) and returns DB/Redis status. /api/metrics is @Public but token-gated with a constant-time compare, 404 when METRICS_TOKEN is unset (metrics.controller.ts:11-17) and blocked at nginx (`location = /api/metrics { return 404; }`). nginx templates have never been run through `nginx -t` (infra/hostinger/README.md:10, acknowledged). Tag: VERIFIED / ASSUMPTION for the live edge.

### SEC-19 - INFORMATIONAL - Documentation drift
- docs/security.md "Not yet done" still lists CSP as pending, but apps/web/src/proxy.ts + csp.ts implement a nonce-based CSP; claims "lint rule forbids `$queryRawUnsafe`" - the rule (eslint.config.mjs:18) forbids only `$queryRawUnsafe`, not `$executeRawUnsafe` (used in seed/seed.ts:33-35 with table names from information_schema; seed refuses to run in production, seed.ts:60). docs/security.md says identical auth errors (see SEC-09). Tag: VERIFIED.

### SEC-20 - INFORMATIONAL - AI exposure: none found
- No LLM SDK, no API key variable, no prompt code anywhere in apps/ or packages/ (dependency lists: apps/api/package.json has no AI client; grep for openai/anthropic/gemini/langchain/llm found nothing in source). "Duplicate detection" and "item statistics" are deterministic (packages/shared/src/similarity.ts, psychometrics.ts; questions.service.ts:81 says "nothing leaves the system"). S3 settings exist in config.ts but no S3 client is used. Tag: VERIFIED.

---------------------------------------------------------------------------------------------------

## Controls verified as working (with evidence)

Authentication and sessions
- Opaque 256-bit tokens (`randomBytes(32)`), stored only as SHA-256 (`auth.service.ts:~85`, `common/auth.ts:42`); cookie HttpOnly, SameSite=Lax, Secure by production/https/WEB_ORIGIN (`common/auth.ts:35-40`); new session per login, absolute expiry (SESSION_TTL_HOURS default 12, production max 24).
- Revocation: logout, deactivation, password change/reset, MFA enable, teacher decisions and scope changes revoke DB sessions and `dropUserSessions()` the 120 s cache (`auth.service.ts:170-205`, `org.service.ts:164-166`, `teacher-admin.service.ts:73,85,112,127`, `directory.service.ts:169`).
- Passwords: argon2id (library defaults), policy min 10 / 3 of 4 classes / no common words / no name (`packages/shared/src/password.ts`), 5-password history, dummy-hash timing equalisation, lock after 5 failures for 15 min, atomic failure counter.
- Reset: OTP hashed, 10 min, 5 guesses consumed atomically via conditional UPDATE, single-use, then single-use token via `kv.take` (`auth.service.ts:160-185`).
- TOTP: RFC 6238, secret encrypted AES-256-GCM with HKDF (`common/secretbox.ts`), replay blocked by compare-and-set on `totpLastStep`, 10-try cap, recovery codes hashed and single-use, self-disable refused for MFA roles, admin reset by SUPER_ADMIN only.
- Portal separation: `PORTAL_ENFORCE` checked in the guard and at login with the same 401 message; nginx and the launcher overwrite `X-OES-Portal` (`infra/hostinger/nginx/*.conf:60`, `scripts/hostinger-single-site.mjs:56`).

Authorisation
- Global `APP_GUARD` (`app.module.ts:57`); a handler without `@Perm` is denied (`common/auth.ts:104`). I scanned every controller: every HTTP handler has `@Perm` or `@Public`. The public set is exactly: auth login/forgot/verify-code/reset, register, register/verify, teacher-registration (catalog, start, verify), public/verify, health, metrics.
- Permission matrix is a single source of truth (`packages/shared/src/permissions.ts`); TEACHER holds only program.read, teacher.self, teacher.work (no result.*, grading.*, student.read, exam.read). Teacher routes re-check APPROVED profile + active user in the database on every call and require an APPROVED non-revoked assignment owned by the caller; foreign ids return 404 (`teacher.service.ts:88-108, 285-290`, `course-access.service.ts:22-38`). Teacher student list returns names only.
- Role/privilege escalation: no endpoint changes `role`; `userPatch` accepts only active/institutionIds/fullName; CAMPUS_ADMIN may create only STUDENT/LECTURER/INVIGILATOR in its own campuses and manage only those (`org.service.ts:14,143-169`); Zod strips smuggled fields. Only SUPER_ADMIN can create privileged roles.
- Campus isolation: lists, record fetches, exam detail/roster/overrides/results/CSV/reports/audit/incidents/monitor all funnel through `scope.filter/allows/assert` or equivalent Prisma filters (`exams.service.ts:24-64,195-239`, `results.service.ts:55-60,156-169`, `reports.service.ts:76-125`, `invigilation.service.ts:20-34,81-90`, `monitor.service.ts:36-52`, `reports.controller.ts:24-40`). Out-of-scope reads return 404. Invigilators are limited to assigned exam+campus.
- Campus admin and student results: not visible until PUBLISHED (`results.service.ts:159`, `reports.service.ts:76`; students via `resultBatch.status = PUBLISHED`, :182).
- Four-eyes: question review (author != reviewer), paper approval (submitter != approver), bank review, result publication (publisher != examiner approver).

Exam confidentiality and delivery
- Candidate-facing payloads never include the key: `exam_questions.snapshot` stores only label+text, `correctLabel` is a separate column (`exams.service.ts:130-133`); `paperFor()` maps explicit fields (`delivery.service.ts:48-62`); `start()` returns questions only after admission, time-window and state checks; `sheet`, `receipt`, `heartbeat`, `myExams` return no key, no correctness and no unpublished question content. `me/exams` exposes instructions and counts only.
- Unauthorised access: start requires roster membership, ADMITTED status, enrolment eligibility, active account, not self-declared, student's campus participating, exam state startable, `now >= opensAt` / `< closesAt` on the DB clock, campus/candidate suspension check (`delivery.service.ts:108-166`). All attempt routes verify `attempt.studentId === caller` and answer a foreign id with 404 (`:222-231, 270-275, 296-300, 305-310, 427`). Answers are saved only if the question belongs to the exam and the option exists in the snapshot (`:244-247`).
- Answer immutability after seal: row-locked seal transaction, receipt HMAC, digest, DB triggers `attempt_answers_lock_*` (migration.sql:920-940). Live events are filtered by campus/student identity on both fan-out and replay (`events.service.ts:19-26`).
- Result manipulation: no API edits marks; key actions only in RESULT_PENDING/CLOSED before examiner approval and trigger re-review (`results.service.ts:100-113`).

Injection, XSS, headers
- SQL: all raw SQL uses tagged templates (parameterised) including JSON_TABLE id lists and `LIKE` with escaped wildcards (`infra/sql.ts`, `monitor.service.ts:127`); `$executeRawUnsafe` appears only in the dev-only seed. No SQL text appears in error output (`common/errors.ts:21-36`).
- Validation: every body/query goes through `parse(zod)`; bodies bounded (2 MiB `bodyLimit`, per-field max lengths, array caps); UUID params through `ParseUUIDPipe`.
- XSS: no `dangerouslySetInnerHTML`/`innerHTML`/`eval` in apps/web/src; notification links limited to same-origin paths (`packages/shared/src/links.ts:21`); CSP is per-request nonce with `strict-dynamic`, no unsafe-inline/eval in production, frame-ancestors none, object-src none, connect-src self (`csp.ts`); X-Frame-Options, nosniff, Referrer-Policy, HSTS set (`next.config.mjs`, nginx snippets); Helmet on the API.
- CSV exports neutralise formula injection (`reports.service.ts:116`, `teacher.service.ts:37`).
- Uploads: only teacher/user photos and question images, delivered as base64 data URLs inside JSON, mime allow-list PNG/JPEG/WebP (no SVG), magic-byte check, size caps (200 KB photo, 1 MB image), stored as DB blobs and returned as JSON data URLs (never served by path), question images fetchable only by owner or reviewer of the bank (`teacher.service.ts:22-32,365-384`, `bank-review.service.ts:82-88`). No file path handling, no SSRF/child_process in request paths.
- Secrets: production boot refuses weak/identical COOKIE/RECEIPT/MFA/METRICS secrets, DEV_EXPOSE_CODES, non-https origins, localhost, missing TRUST_PROXY/PORTAL/MFA (`config.ts:62-95`). No .env committed (only `.env.example` and infra examples); no secrets printed.
- Metrics endpoint token-gated with timing-safe compare.

Rate limiting: login (IP 60 + account 20 per 15 min), forgot (5/h per email+IP, 10/h per email), verify-code (5 guesses per code), registration (IP/regNo/email), teacher registration, MFA (10/15 min), public certificate verify (20/min), answer save (100/10 s per attempt, in-process), integrity events (60/min). Storage: Redis or `kv_entries` table with DB clock; Fastify `trustProxy` supports a hop count. (Caveat: fail-open in SEC-05; per-process windows noted in code.)

---------------------------------------------------------------------------------------------------

## Could not verify

- Live deployment state (NODE_ENV, MFA_ENFORCE, PORTAL_ENFORCE, TRUST_PROXY hop count, real client IP seen by the API, whether demo accounts exist on the production host).
- nginx templates (never run through `nginx -t`); effective headers, SSE buffering and rate-limit behaviour at the edge.
- Actual DB privileges of the application account (can it DROP TRIGGER / UPDATE results directly?) and backup/restore handling of the audit table.
- Runtime behaviour: I executed no tests; SEC-07 (teacher dashboard), SEC-05 (fail-open) and SEC-11 (lock contention) are code-reading conclusions.
- docs/route-permissions.md and docs/role-permissions.md were not diffed line-by-line against the code; the structural test suite (`security.test.ts`, `route-inventory.test.ts`) was not run. My own controller scan agrees with the claim that every route declares @Perm or @Public.
- Prisma schema field-level encryption/PII classification (student DOB, address, photos stored as DB blobs, unencrypted at rest) and data-retention rules.
- Worker process (`worker.ts`, queues) and BullMQ/Redis exposure beyond the API process.
- Dependency vulnerabilities (docs/security.md says `npm audit` advisories were not triaged).
