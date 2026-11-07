> Evidence file for `docs/audits/SZABMU-OES-INFRASTRUCTURE-AND-AI-READINESS-AUDIT.md` (2026-11-07). Produced by static, read-only code review; nothing was executed. Each finding is tagged VERIFIED (code read at the cited line) or ASSUMPTION. Findings in the main report marked "re-checked" were additionally confirmed by the lead auditor.

# Audit: Exam engine and database (SZABMU OES)

Reviewer scope: apps/api/prisma (schema + 6 migrations), apps/api/src/modules/{delivery,control,invigilation,results,exams,reports}, jobs.service.ts, infra, cron, worker.ts, scripts/auto-migrate.mjs, scripts/db-backup.mjs.
Method: static code reading only. No server started, no database touched, no tests run. Nothing here was executed, so every runtime claim is code-derived (VERIFIED = visible in the code or SQL cited; ASSUMPTION = depends on deployment or load that I could not observe).
All paths are relative to /home/user/SZABMU-OES. "delivery" = apps/api/src/modules/delivery/delivery.service.ts.

## Severity counts
CRITICAL 0 | HIGH 4 | MEDIUM 12 | LOW 7 | INFORMATIONAL 4  (27 findings)

---

## 1. Entity inventory (model groups and purpose)
Schema: apps/api/prisma/schema.prisma, 1541 lines, 59 models, 36 enums, MySQL provider, all tables utf8mb4_unicode_ci (baseline migration), UUID PKs as CHAR(36), DATETIME(3) in UTC.

| Group | Models | Purpose |
|---|---|---|
| Organisation | Institution, Department, Program, Course | Campuses/colleges, programmes, university-level subjects (course = programme + semester + credits) |
| Directory (new, 20261107 migration) | AwardingBody, InstitutionProgramOffering, OfferingAllocation, OfferingSession, DirectorySource, DirectoryClaim, ProgramAlias, CurriculumDocument, DirectoryImportRun, DirectoryImportChange | Sourced directory of institutions/programmes, with import runs and rollback data |
| Identity | User, UserInstitution, Session, PasswordReset, PasswordHistory, MfaRecoveryCode, TeacherProfile, StudentSignup | Accounts, scoping, sessions, MFA, teacher/student registration |
| Students | RosterEntry, Student, Enrollment | Official register, student profile (incl. photo BLOB), per-course/term enrolment and eligibility |
| Question bank | Question, QuestionOption, QuestionPool, QuestionImage (BLOB), QuestionVersion (append-only) | Items with difficulty/topic/subtopic/bloom/tags, review state, version history |
| Exam definition | Exam, ExamInstitution, ExamQuestion (frozen snapshot + correctLabel), ExamCandidate, ExamInvigilator, ExamRosterVersion (append-only), EligibilityOverride (append-only) | Paper, venue campuses, roster, accommodations |
| Live attempt | Attempt, AttemptAnswer (current answer), AnswerEvent (append-only journal), AttemptEvent, AttemptHeartbeat | Delivery state, per-save journal, integrity events |
| Control plane | ExamSuspension, ExamExtension, ExamCommand (idempotency ledger), ExamEvent (outbox), LifecycleLease, LifecycleRun, AppLock | State machine support, SSE outbox, reconciler lease |
| Grading/results | KeyAction, ResultBatch, Result, Certificate (+ MariaDB SEQUENCE certificate_serial_seq) | Key corrections, review workflow, marks, certificates |
| Incidents | Incident, IncidentNote | Invigilation incidents |
| Cross-cutting | Notification, OutboundMessage (mail outbox), AuditLog (SHA-256 hash chain), KvEntry (DB-backed cache/rate-limit when no Redis) | Messaging, audit, coordination |

Relationships that matter for analytics: Exam 1-n ExamQuestion n-1 Question (n-1 Course n-1 Program); Attempt (unique examId+studentId) 1-n AttemptAnswer (PK attemptId+examQuestionId) n-1 ExamQuestion; Result (unique examId+studentId) 0..1-1 Certificate; Result.attemptId is a bare CHAR(36) with no FK (see DB-14).

---

## 2. End-to-end trace: start attempt -> answer save -> submit -> score -> publish

1. **Start** `POST /attempts/start` -> delivery.controller.ts:34-35 -> `DeliveryService.start` (delivery.service.ts:124-190).
   - Roster membership check :126; existing attempt resume/ALREADY_SUBMITTED :131-133; expiry on DB clock `isExpired` :134,193-200.
   - New attempt gates: admission closed/suspended/startable state/paper APPROVED :139-142, campus/candidate suspension hold :143 (JSON_ARRAY path query on `exam_suspensions.studentIds`), window :145-146, eligibility re-check `admit` :149 (:108-121; result frozen into `attempts.admission` JSON).
   - Deadline `computeDeadline` / `syncDeadline` from DB `SYSDATE(3)` (`dbNow`, prisma.service.ts:27) :152; question order seeded shuffle stored in `questionOrder` JSON :155.
   - Single INSERT creates attempt + STARTED event :160; unique(examId, studentId) makes double-start safe, P2002 loser resumes the winner :163-165.
   - Single-active-client claim by guarded UPDATE with `clientEpoch` bump :170.
2. **Save** `PUT /attempts/:id/answers/:qid` -> delivery.controller.ts:37-51 (zod validation, per-process 100/10s limiter :43) -> `saveAnswer` :216 -> `writeAnswer` :240-264, one transaction:
   - `SELECT ... FROM attempts ... AND status='IN_PROGRESS' AND activeClientId=? AND suspendedAt IS NULL AND deadlineAt+5s > NOW(3) LOCK IN SHARE MODE` :243-251 (server-side deadline and stale-tab check in the same statement as the lock). Also validates the question belongs to the exam and the label exists in the frozen snapshot via JSON_CONTAINS :244-245.
   - `SELECT revision ... FOR UPDATE` on the answer row :254; apply only if `d.revision > cur.revision` :255; UPDATE or INSERT :256-259; journal INSERT into `answer_events` :260. Wrapped in `retryOnDeadlock` (sql.ts:35) and a duplicate-key retry :220-224.
   - Replay of identical revision/content returns `duplicate:true` :231-234; otherwise 409 STALE_REVISION :235.
   - DB-level backstop: trigger `attempt_answers_lock_*` refuses writes to a non-IN_PROGRESS attempt (baseline migration.sql:920-935); CHECK constraints on state/label consistency (:951-953).
3. **Heartbeat** `heartbeat` :282-302: one read with `NOW(3)`; if expired it calls `finalize(AUTO)` :293-295; records liveness to Redis or `attempt_heartbeats` (kv.service.ts:162-169).
4. **Submit** `POST /attempts/:id/submit` -> delivery.controller.ts:66-77 -> `submit` :325 -> `finalize` :414 -> `seal` :336-411:
   - Cheap pre-read outside any transaction :341; sealed replay returns the stored receipt without a transaction :350.
   - Transaction with `SELECT ... FOR UPDATE` on the attempt row and DB-clock expiry computed under the lock :356-360; refuses submit while suspended :369 and from a superseded client :370; optional `expected` revision/label cross-check -> 409 ANSWERS_OUT_OF_SYNC :373-383; `late` decision :371 -> status SUBMITTED vs AUTO_SUBMITTED :388.
   - Digest of the sheet in paper order :385; HMAC receipt `receiptCode(RECEIPT_SECRET, attemptId, digest, submittedAt)` :387; single UPDATE + `attempt_events` insert :392-393. CHECK `attempts_submitted_has_receipt` (baseline :955).
   - Best-effort enqueue of a BullMQ grade job, 1.5 s time-box :404-407.
5. **Auto-seal** (no candidate action): lifecycle.service.ts `expireAttempts` :116-141 selects expired IN_PROGRESS attempts on the DB clock and calls `sealIfExpired` (delivery.service.ts:420) which re-checks expiry under the row lock :368. CLOSE(force) uses `forceClose` :158-170.
6. **Score** `ResultsService.gradeAttempt` (results.service.ts:19-45): called by the BullMQ consumer (jobs.service.ts:29) or by the reconciler `gradeUngraded` (lifecycle.service.ts:224-236). Reads attempt+answers, `exam_questions.correctLabel`, then replays `key_actions` in time order :22-30; `scoreQuestion` (packages/shared/src/exam-rules.ts:57-62) deterministic; `sumScores` clamps 0..totalMarks and rounds to 2 dp :64-67; upserts `results` + `result_batches` :36-43.
7. **Exam goes CLOSED -> SCORING -> RESULT_PENDING**: lifecycle `closeExams` :173-188, `autoScoring`, `progressScoring` :202-222 creates ABSENT rows :211-213 and moves to RESULT_PENDING under `SELECT ... FOR UPDATE` on the exam :208.
8. **Review chain**: `keyAction` (results.service.ts:100-114) -> `lecturerReview` :116-122 -> `examinerApprove` :124-133 (blocks on open incidents :127) -> `publish` :135-153 (examiner != publisher four-eyes :139; certificates minted in the publish transaction :141-148 via `NEXTVAL(certificate_serial_seq)`).
9. **Student read** `myResults`/`myCertificate` :179-197 gated on `resultBatch.status='PUBLISHED'`; public certificate verification :200-205.

---

## 3. Findings

### HIGH

**DB-01 | HIGH | Key correction + regrade is not atomic, not resumable and can race with approval**
- Where: apps/api/src/modules/results/results.service.ts:100-114 (`keyAction`), :48-52 (`regradeExam`); apps/api/src/modules/control/lifecycle.service.ts:224 (`gradeUngraded` only selects attempts with NO result row).
- Evidence: `keyAction.create` (:109), the batch reset to GRADED (:110, with `.catch(() => undefined)`), then a sequential `for` loop calling `gradeAttempt` per attempt (:50) are three separate, non-transactional steps in the HTTP handler. `gradeAttempt` runs 3-4 queries per attempt (:20-23). The state check (:102) is a plain read, no row lock. `lecturerReview` (:118) and `examinerApprove` (:126) check only `resultBatch.status`, which the key action has already reset to GRADED, so a second reviewer can move the batch to LECTURER_REVIEWED/EXAMINER_APPROVED while the loop is still re-scoring. If the process dies mid-loop nothing resumes it: `gradeUngraded` ignores attempts that already have a (now stale) result.
- Impact: a published/approved result set can contain a mix of marks computed with and without the key change. Marks integrity is the core product promise. At ~12k attempts the loop is tens of thousands of sequential queries (ASSUMPTION on duration).
- Recommendation: store on `Result` the highest `key_actions` id/sequence it was scored against; have the reconciler regrade any result below the exam's current key sequence; refuse lecturer review/approve/publish while any result is behind (or while a regrade flag is set on `ResultBatch`); do the key action + batch reset in one transaction under `SELECT ... FOR UPDATE` on the exam row.
- Tag: VERIFIED (code). Duration at scale ASSUMPTION.

**DB-02 | HIGH | Results are not sealed at the database level; scoring can overwrite a published mark**
- Where: results.service.ts:36-43 (`result.upsert` ... `update: {rawScore, percent, status, gradedAt}`), no state guard in `gradeAttempt` (:19-21); baseline migration.sql:902-948 and later migrations contain triggers only for audit_logs, answer_events, exam_roster_versions, eligibility_overrides, attempt_answers, exam_events, question_versions. grep for triggers on `results`, `result_batches`, `key_actions`, `certificates`: none.
- Evidence: `gradeAttempt` accepts any non-IN_PROGRESS, non-VOID attempt and overwrites the result regardless of `ResultBatch.status` or `Exam.status`. It is reachable from a BullMQ job (a retried job can run late), `regradeExam`, and the reconciler. Immutability after PUBLISHED therefore rests on application call-site discipline only. Direct SQL (DBA, hosting panel user, a future endpoint) can edit `results.rawScore`/`percent`/`status` or delete a `certificates` row with no trigger and no audit record. `Result.adjustment` (schema.prisma:948) is never read or written anywhere in src (grep): a dead column that looks like a moderation hook.
- Impact: published results and certificates are not tamper-evident. The audit hash chain covers staff actions, not the marks themselves. There is also no stored scoring version or result hash (docs/audits/DATA_INTEGRITY_FINDINGS.md DI-02 accepts this as "documented").
- Recommendation: BEFORE UPDATE/DELETE trigger on `results` that raises when the exam's batch is PUBLISHED (and on `certificates` deletion); add `scoredKeyVersion` and a per-result hash included in the publish audit entry; remove or implement `adjustment`.
- Tag: VERIFIED.

**DB-03 | HIGH | No withhold / void path exists: enum states WITHHELD and AttemptStatus.VOID are never set, so misconduct or disputed attempts cannot be excluded from publication**
- Where: schema.prisma:236 (`VOID`), :273 (`WITHHELD`); grep across apps/api/src: `VOID` is only read in results.service.ts:21 as a guard, `WITHHELD` appears nowhere in src.
- Evidence: `publish` (results.service.ts:135-153) publishes every Result row in the exam and mints certificates for every `PASS`. `examinerApprove` only blocks on exam-level open incidents (:127). There is no per-candidate hold, no way to mark an attempt VOID, and ABSENT is the only non-scored status written.
- Impact: a candidate under a misconduct investigation either blocks the whole exam (open incident) or is published with a certificate. Pairs with DB-02.
- Recommendation: implement per-result WITHHELD and attempt VOID transitions (permissioned, reasoned, audited), exclude them from publish and certificate minting, and make `myResults` honour them.
- Tag: VERIFIED (absence by grep of apps/api/src; seed code not checked).

**DB-04 | HIGH | Backup/restore has never been demonstrated against the production engine; documentation about it contradicts itself**
- Where: scripts/db-backup.mjs (196 lines); docs/operations/backup-restore.md; docs/implementation-status.md:148-149; docs/audits/DATA_INTEGRITY_FINDINGS.md:29 (DI-03) and :31 (DI-05).
- Evidence: the tool itself is well designed (consistent-snapshot read, per-table SHA-256 fingerprints, trigger and migration-history checks, restore into a disposable server). But: (a) DATA_INTEGRITY_FINDINGS DI-03 states it is "Open - needs access to the production database host"; (b) implementation-status.md:148 says verification happened on the synthetic dev DB and the earlier PostgreSQL fault suite, and :149 lists "PITR, encryption, scheduling/retention/off-site, restore-time at production size" as not done and "blocking for any real deployment"; (c) backup-restore.md says `test:fault` "still drives disposable PostgreSQL clusters ... has not been ported", while DATA_INTEGRITY_FINDINGS DI-05 says "Fixed: harness ported; 17 passed" - the two docs disagree; (d) nothing in the repository schedules a backup, ships it off-site, encrypts it (dumps contain password hashes, TOTP ciphertext and answer keys, written as plain .sql) or enforces retention; (e) a 20k-candidate dump is built by row-by-row JSON.stringify fingerprinting in one Node process (Node memory/time at production size unmeasured, per the runbook).
- Impact: RPO = whatever backup the operator last took by hand; RTO unknown; for a high-stakes exam system this is the largest operational risk after DB-01/02.
- Recommendation: run `backup:verify` against a copy of the real Hostinger data and record the evidence; schedule pre-open/post-close backups; encrypt and ship off-site; reconcile the two docs.
- Tag: VERIFIED (docs vs code); production state ASSUMPTION/unknown.

### MEDIUM

**DB-05 | MEDIUM | Item analysis reports a stale answer key and mismatching p-values after a key change**
- Where: results.service.ts:93-95.
- Evidence: the effective key (after CHANGE_KEY / VOID) is built at :79-81 and used for the psychometric block (`stats`, :83-84), but the per-question `correctN = dist[q.correctLabel]`, `pCorrect`, `flag` and the returned `key: q.correctLabel` (:93-95) use the ORIGINAL snapshot key. After a key correction the same row shows `key` = old label, `pCorrect` for the old key, and `stats.p` for the new key. The "VERY_HARD_OR_MISKEYED" flag fires in exactly the situation where reviewers are about to correct a key, then keeps firing afterwards.
- Impact: reviewers can approve results on contradictory statistics.
- Recommendation: use `eff.get(q.id).correct` for `key`, `correctN`, `pCorrect` and exclude voided items.
- Tag: VERIFIED.

**DB-06 | MEDIUM | Large publish runs per-certificate round trips inside one transaction that has a 30 s default timeout**
- Where: results.service.ts:140-148; config.ts:17-18 (`DB_TX_TIMEOUT_MS` default 30000); prisma.service.ts:16 (comment says remote DB round trips are "tens of ms").
- Evidence: the `for (const r of passes)` loop issues `SELECT NEXTVAL` plus `certificate.upsert` (two or more statements) per passing student inside `$transaction`. Pass list is read outside the transaction (:140). Check-then-act (:137-139) is not locked, so two concurrent publishes both pass the status check; the upserts are idempotent but sequence numbers are burned and the audit/notification run twice.
- Impact: for thousands of passes on a remote DB the publish rolls back at the timeout (safe but the exam cannot be published); concurrent double-click publishes duplicate side effects. Serial numbers are `SZABMU/<year>/<seq>` and will have gaps (MariaDB sequences are not transactional) - acceptable for serials but worth stating.
- Recommendation: lock the exam/batch row first, mint certificates set-based (INSERT ... SELECT with a sequence or a bulk-allocated block), raise the transaction timeout for this call, and re-read PASS rows inside the transaction.
- Tag: VERIFIED (code); latency ASSUMPTION.

**DB-07 | MEDIUM | Review workflow four-eyes is partial; check-then-act transitions are unlocked**
- Where: results.service.ts:116-133; packages/shared/src/permissions.ts:45-49.
- Evidence: only `publish` compares actors (:139, publisher != examiner). `lecturerReview` stores `reviewedBy` but `examinerApprove` never checks `examinerApprovedBy != reviewedBy`, and `keyAction`'s actor is not compared with either. SUPER_ADMIN holds grading.review, grading.keyaction, result.approve_examiner and result.publish, so one super-admin can do key action, review and approve, and a second one publishes. All three transitions read `resultBatch.status` without a lock and update unconditionally (`update ... where examId` with no status predicate).
- Impact: separation of duties between lecturer and examiner is by convention; concurrent clicks can double-apply.
- Recommendation: add the missing actor comparisons and make each transition a guarded `UPDATE ... WHERE status = <expected>` checking affected rows.
- Tag: VERIFIED.

**DB-08 | MEDIUM | Scoring is a per-attempt query loop; regrade and item analysis load whole cohorts in the API process**
- Where: results.service.ts:19-23 and :48-51 (4 queries per attempt, sequential); :82 (`attempt.findMany` with all answers for every sat attempt) and :66-71.
- Evidence: `gradeAttempt` loads the exam row, answers, all exam_questions and all key_actions again for every attempt. `itemAnalysis` materialises candidates x questions answer objects into memory (for example 10k candidates x 100 questions = 1M objects) in the web API process. `examResults`/`examCsv` (:160, reports.service.ts:120) are unbounded per exam (bounded by cohort).
- Impact: latency and memory pressure on the same process that serves exam saves if analysis is opened during or soon after a sitting; N+1 pattern in regrade.
- Recommendation: load exam_questions/key actions once per exam and score in batches; compute item statistics with SQL aggregates or in the worker.
- Tag: VERIFIED (pattern); impact at scale ASSUMPTION. The docs' load tests (docs/implementation-status.md:176-178) exercised delivery and sealing, not this path.

**DB-09 | MEDIUM | Reconciler lease can lapse mid-step and has no fencing token**
- Where: lifecycle.service.ts:20 (`leaseSeconds` default 15 s, `BUDGET_MS` 20 s), :53-60 (acquire), :62 (renew only between steps, :96-100 `step()`), :116-141.
- Evidence: a single step (e.g. `expireAttempts` sealing batches of 200 at concurrency 8, or `gradeUngraded`) can run longer than the 15 s lease while renew is only called between steps. A second instance can then acquire the lease and run the same step concurrently. Because the steps are idempotent (row locks, `SKIP LOCKED`, guarded updates) this should not corrupt data, and the code states that design intent (:24-25), but it is unfenced and duplicated work during peak submit time is exactly when it would happen.
- Impact: duplicate load at the worst moment; stats and `lifecycleRetries` double counting. No data-loss path found.
- Recommendation: renew inside long loops, or make lease >= budget + margin; add an epoch/owner check to writes that bump counters.
- Tag: VERIFIED (code); occurrence ASSUMPTION.

**DB-10 | MEDIUM | "Poisoned" attempts stall the exam permanently and silently**
- Where: lifecycle.service.ts:122 (`lifecycleRetries < 5`), :173-186 (`closeExams` requires no IN_PROGRESS attempt), :204-222.
- Evidence: after 5 failures an IN_PROGRESS attempt is excluded from sealing. `closeExams` and `progressScoring` both wait for zero IN_PROGRESS, so the exam stays in CLOSING/LIVE forever. The only signal is `stats.poisoned` and the control-centre health block (:243-258); there is no alert and no automatic last-resort path.
- Impact: one bad row blocks result processing for an entire exam until an operator notices.
- Recommendation: alert on poisoned > 0; provide an audited operator action to force-seal or void a poisoned attempt.
- Tag: VERIFIED.

**DB-11 | MEDIUM | Isolation level, collation and SQL mode are assumed, not enforced by the application**
- Where: apps/api/src/infra/db-url.ts:11-14 (`SESSION_INIT_SQL` sets time_zone, ANSI_QUOTES, STRICT_TRANS_TABLES only); isolation set in docker-compose.yml:14 and .github/workflows/ci.yml:11,30,49,66 only; docs/audits/DATA_INTEGRITY_FINDINGS.md:3 asserts production is READ COMMITTED.
- Evidence: nothing in application code sets `transaction_isolation`. The save/seal locking design and the comment "(read answers, fresh snapshot so a save we waited for is included)" (delivery.service.ts:352-353) are reasoned for READ COMMITTED. InnoDB's default is REPEATABLE READ; whether Hostinger's managed server is READ COMMITTED is not shown anywhere. Under RR plain reads after the lock still see the committed row here because the first statement is a locking read, but other flows (for example `progressScoring`, `refreshRoster`) were not analysed for RR. Collation is utf8mb4_unicode_ci everywhere, so unique indexes and comparisons on `regNo`, `code`, `receiptCode`, `verifyCode`, `tokenHash` are case-insensitive and accent-insensitive; this is deliberate for emails (CHECK `users_email_lower`) but means `regNo` "abc" and "ABC" collide (acceptable) and Urdu/Arabic-script names sort by unicode_ci rules.
- Impact: correctness depends on an unverified server setting.
- Recommendation: add `SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED` to `SESSION_INIT_SQL` and assert at startup; log `@@transaction_isolation`, `@@sql_mode`, `log_bin_trust_function_creators` in the health endpoint.
- Tag: ASSUMPTION (production settings not visible); code absence VERIFIED.

**DB-12 | MEDIUM | No retention, archival or data-subject deletion policy; hot journal tables grow unbounded**
- Where: grep for DELETE/prune in apps/api/src: only `lifecycle_runs` (lifecycle.service.ts:102) and expired `kv_entries`/`attempt_heartbeats` (kv.service.ts:216-217) are ever pruned. `sessions`, `password_resets`, `password_history`, `notifications`, `outbound_messages`, `answer_events`, `attempt_events`, `exam_events` (trigger forbids DELETE, baseline migration.sql:940), `incidents` have no purge.
- Evidence: `answer_events` gets one row per accepted save (delivery.service.ts:260), indexed on (attemptId, examQuestionId, revision) and made undeletable by trigger (baseline :906-909). Every FK to students/exams is RESTRICT (FK listing in migrations) and the answer-lock triggers refuse deleting finalised attempt answers, so a student or exam can never be erased. `students.photo` and `question_images.data` are BLOBs inside the primary database (schema.prisma:545, :1299).
- Impact: storage and backup size grow with every sitting; no way to honour a deletion/anonymisation request or a retention schedule; backups (DB-04) carry all of it.
- Recommendation: define retention per table (policy P-xx), add an archival job that copies journals to cold storage before a documented, audited purge procedure (drop trigger under change control), and an anonymisation procedure for students.
- Tag: VERIFIED (absence); sizes ASSUMPTION. The docs list retention as a "policy decision" not made.

**DB-13 | MEDIUM | Question images are stored and reviewed but never delivered to candidates**
- Where: schema.prisma:611 (`Question.imageId`); exams.service.ts:132 (snapshot has only type, vignette, stem, options); delivery.service.ts:24 (`PaperQuestion` has no image); grep `imageId` in apps/api/src shows use only in questions.service.ts and the teacher/bank-review services.
- Evidence: a question with a diagram (clinical image) passes review (bank-review.service.ts serves it to reviewers) and is approved, but the frozen snapshot omits the image reference and no delivery route serves it.
- Impact: candidates would see a stem that refers to an image that is not there. Content-integrity issue for clinical MCQs.
- Recommendation: put `imageId` (and image `sha256`) into the snapshot, add an authenticated delivery route for exam images, add a test.
- Tag: VERIFIED by grep; web client not read in this review (apps/web grep returned no matches for question images).

**DB-14 | MEDIUM | Several evidential references have no foreign key or no integrity enforcement**
- Where: schema.prisma: `Result.attemptId` (:946), `AnswerEvent.attemptId/examQuestionId` (:842-843), `Attempt.suspensionId` (:803), `Incident.studentId` (:874), `Exam.createdBy/paperSubmittedBy/paperApprovedBy`, `Question.authorId/reviewedBy`, `KeyAction.actorId`, `ResultBatch.reviewedBy/examinerApprovedBy/publishedBy`, `AuditLog.actorId`, `AttemptHeartbeat.*` (deliberate, comment :1351).
- Evidence: FK list from the migrations (grep of `ADD CONSTRAINT ... FOREIGN KEY`) shows no constraint for these columns. Actor columns are plain CHAR(36); `Result.attemptId` can point to nothing, and a result can be graded from attempt A while carrying attempt B's id without the database noticing. `answer_events` has no FK (probably intentional to keep inserts cheap and the journal immune to cascades).
- Impact: orphaned or wrong references cannot be ruled out by the database; user deletion is RESTRICTed elsewhere so actor columns will remain resolvable in practice.
- Recommendation: add FK (or a CHECK/trigger) for `results.attemptId` -> `attempts.id` and unique it; keep actor columns as is but document.
- Tag: VERIFIED.

**DB-15 | MEDIUM | Score-affecting inputs are not versioned on the paper; analytics join to mutable question rows**
- Where: schema.prisma:722-738 (`ExamQuestion`: snapshot JSON + correctLabel, no question version, no topic/difficulty/bloom captured); exams.service.ts:130-134; questions.service.ts:122-135 (edit replaces options, bumps `version`, sets status DRAFT).
- Evidence: `QuestionVersion` stores full history, but `exam_questions` records only `questionId`, not the version used; the snapshot omits `difficulty/topic/subtopic/bloom/defaultMarks/imageId`. After the author edits the live question, any analytics joining `exam_questions -> questions` sees current metadata, not what was on the paper.
- Impact: per-topic or per-bloom reporting for past exams is silently wrong after edits.
- Recommendation: add `questionVersion` to `exam_questions` and copy topic/difficulty/bloom into the snapshot at approval.
- Tag: VERIFIED.

**DB-16 | MEDIUM | Per-attempt TIMING and payload design: heavy writes on every save; journal is the only per-question timing signal**
- Where: delivery.service.ts:243-251 (JSON_CONTAINS over the full frozen snapshot JSON on every save), :260 (journal row per save); schema.prisma:840-852.
- Evidence: each save parses the whole `exam_questions.snapshot` (stem, vignette, all options) to validate a label, takes a share lock on the attempt, an exclusive lock on the answer row, and writes two rows. Documented capacity numbers (docs/implementation-status.md:174-178) were produced on PostgreSQL; docs/audits/DATA_INTEGRITY_FINDINGS.md:#20 reports only a local 1,000-candidate MariaDB run, not on Hostinger.
- Impact: no evidence of capacity on the actual stack; the JSON parse is avoidable (labels could be validated against cached paper in memory).
- Recommendation: validate the label against the cached paper (`paperFor`) in application code, or add a lightweight `exam_questions.labels` column; run the load test against the Hostinger MariaDB.
- Tag: VERIFIED (design); capacity ASSUMPTION.

### LOW

**DB-17 | LOW | `start` is not serialised against a concurrent close**
- Where: delivery.service.ts:126-160 vs lifecycle.service.ts:173-188 and control.service.ts:close.
- Evidence: exam state is read at :126 and the attempt INSERT at :160 are separate statements with no lock on the exam row; `closeExams` selects exams with "NOT EXISTS IN_PROGRESS attempt" and locks the exam row, and an INSERT into attempts needs a shared lock on the parent exam row, so an attempt can be inserted after the exam became CLOSED. Its deadline is capped at `closesAt` so the reconciler seals it within seconds.
- Impact: brief IN_PROGRESS attempt on a CLOSED exam; self-heals. Window is milliseconds.
- Tag: ASSUMPTION (reasoned from InnoDB FK locking).

**DB-18 | LOW | Revoked candidates receive ABSENT results**
- Where: lifecycle.service.ts:211 (`FROM exam_candidates c WHERE c.examId = ? AND NOT EXISTS (attempt)`), no `c.status` filter.
- Evidence: REVOKED candidates (never admitted) are written as `ABSENT` and appear in result lists/exports (`examResults` counts them as absent).
- Impact: attendance statistics blur "not eligible" with "did not turn up".
- Recommendation: skip REVOKED, or write WITHHELD/NOT_ELIGIBLE (ties to DB-03).
- Tag: VERIFIED.

**DB-19 | LOW | Event delivery ordering assumes commit order equals id order**
- Where: events.service.ts:131-139 (`dispatch` drops events with `ev.id <= s.lastId`), :165 (poll `id > polledUpTo`), schema.prisma:1174 (AUTO_INCREMENT id).
- Evidence: with concurrent transactions a lower id can commit after a higher id has been published; subscribers then ignore it and the poll skips it. `aggregateVersion` and the heartbeat's `stateVersion` (delivery.service.ts:301) let clients detect a gap and refetch, and `gap` is returned by `replay`, so this degrades to a delayed refresh rather than a missed state.
- Tag: ASSUMPTION (reasoned; not reproduced).

**DB-20 | LOW | Outbox publisher holds a DB transaction open across external calls**
- Where: events.service.ts:67-83 (`FOR UPDATE SKIP LOCKED` on up to 200 rows, `kv.publish` inside the transaction, 20 s timeout).
- Evidence: slow Redis delays commit of the delivery bookkeeping and holds row locks and a pooled connection. Failures are bounded (`MAX_RETRIES` 10, then FAILED, no automatic re-drive and `exam_events` has no purge).
- Tag: VERIFIED.

**DB-21 | LOW | Global audit-chain lock serialises every control transition**
- Where: audit.service.ts:50 (`SELECT ... FROM app_locks WHERE name='audit_chain' FOR UPDATE`) called from control/transition.ts:24 inside every exam state change and from `audit.log` for every staff action.
- Evidence: all exams share one lock; `autoStart` can lock up to 50 exams' transitions in one transaction (lifecycle.service.ts:142-151) holding the chain lock for the whole batch. `verifyChain` (:63) loads up to 100k rows into memory. The chain detects row edits only while the append-only triggers exist; a DB administrator can drop triggers and rewrite the whole chain since no head hash is anchored outside the database.
- Tag: VERIFIED (code); contention ASSUMPTION.

**DB-22 | LOW | Mail outbox keeps recovery-code mail bodies and has no purge; sessions never purged**
- Where: infra/mail.service.ts:30-31 (`body` stored in `outbound_messages`), :60-61 (SENT rows kept); cron/reconcile.ts:13-14 comment says the outbox carries password-recovery codes; no deletion of `sessions`, `password_resets`, `outbound_messages` anywhere in src.
- Impact: secrets-at-rest in a table that is also in every backup. Exact body contents not read.
- Tag: VERIFIED (no purge); body content ASSUMPTION.

**DB-23 | LOW | Invigilator single-attempt extension bypasses the control-plane ledger**
- Where: invigilation.service.ts:68-79 vs control.service.ts:extend.
- Evidence: updates `deadlineAt` directly (cap 60 min per call in the controller, no cumulative cap, can exceed `closesAt`), writes no `exam_events` outbox row and no `ExamExtension` record; the candidate learns via the next heartbeat. It does write `attempt_events` and an audit row.
- Tag: VERIFIED.

### INFORMATIONAL

**DB-24 | INFO | Documentation drift**
- docs/data-model.md:3 says "PostgreSQL 16 ... 3 migrations"; the repo has 6 MariaDB migrations (the PG ones are archived in apps/api/prisma/migrations-postgres-archive). docs/exam-engine.md:6-12 describes `ON CONFLICT`/`EXCLUDED.revision` upserts and `FOR KEY SHARE`; the code uses `LOCK IN SHARE MODE` + read-then-update (delivery.service.ts:251-259). docs/data-model.md:30 says "advisory-locked append"; code uses an `app_locks` row. docs/audits/DATA_INTEGRITY_FINDINGS.md:#21 claim "No defect was found in answer persistence, sealing, timing or grading" is consistent with the delivery code I read, but does not consider DB-01/02/05.
- packages/shared/src/constants.ts:1 `EXAM_STATUSES` omits ADMISSION_OPEN/SUSPENDED/CLOSING/SCORING that the schema has.
- Tag: VERIFIED.

**DB-25 | INFO | Connection pool and Hostinger limits**
- config.ts:15 `DB_POOL_MAX` default 20 per process; db-url.ts:36-40 idleTimeout 240 s, minimumIdle 2 (comment cites a 500 new connections/hour/user Hostinger limit); text protocol, no prepare cache (prisma.service.ts:15). API + worker + each cron `reconcile` each open their own pool; total concurrent connections are bounded by processes x 20, not by a central cap. Heartbeat (every 15 s per candidate, shared/constants.ts) does one 3-table join read plus, without Redis, an upsert (kv.service.ts:168), i.e. 2 DB statements per candidate per 15 s. Server `max_user_connections` is not visible.
- Tag: VERIFIED for settings; limits ASSUMPTION.

**DB-26 | INFO | Migration strategy**
- Six migrations, forward-only; every migration after the baseline is stated and appears additive (nullable/defaulted columns, new tables, one VARCHAR widening in 20261104100000). No `down` migrations; rollback = restore from backup (see DB-04). scripts/auto-migrate.mjs runs `prisma migrate deploy` at site start (relies on Prisma's GET_LOCK, a failure is logged and the launcher continues, so the app can run against an out-of-date schema; scripts/auto-migrate.mjs:27-35). The PostgreSQL -> MySQL conversion is a one-off row copy (scripts/pg-to-mysql.mjs, 92 lines) plus verifier (scripts/pg-mysql-verify.mjs); it copies the table list at :19-22 and temporarily drops the answer-lock triggers. The `migrations-postgres-archive` directory remains in the tree. I did not run either script.
- Tag: VERIFIED (code read).

**DB-27 | INFO | JSON columns and soft-delete patterns**
- JSON used for: `Question.tags`, `Attempt.questionOrder`, `Attempt.admission`, `ExamQuestion.snapshot`, `ExamSuspension/Extension.studentIds` (candidate id arrays queried with JSON path in delivery.service.ts:143), `ExamEvent.payload`, `AuditLog.meta`, `lockedFields`, `AttemptEvent.detail`, `ExamRosterVersion.snapshot`. MariaDB JSON is LONGTEXT with a validity CHECK: no JSON indexes, so id arrays are unindexed (small). Soft-delete: `CourseAssignment.revokedAt` (with generated-column partial unique), `ExamCandidate.status REVOKED`, `Certificate.revokedAt`, `Institution.active`, `User.active`, `QuestionStatus.RETIRED`; there is no generic `deletedAt`, and queries must remember each flag (for example `myCertificate` checks revokedAt, results.service.ts:195).
- Tag: VERIFIED.

---

## 4. Analytics data quality (item analysis readiness)

What exists (VERIFIED):
- Per-answer: `selectedLabel`, `state` (ANSWERED/SKIPPED/CLEARED), `markedForReview`, `visited`, `revision`, `savedAt` (attempt_answers); full per-save history with timestamps in `answer_events` (option chosen at each revision).
- Per-attempt: `startedAt`, `submittedAt`, `deadlineAt`, `extraTimeMin`, `integrityFlags`, `attempt_events` (tab hidden, fullscreen exit, offline, etc.).
- Per-question metadata: `difficulty` (EASY/MEDIUM/HARD, author-assigned), `topic`, `subtopic` (free text VARCHAR(191)), `bloom` (optional enum), `tags` JSON, `defaultMarks`, `usedCount`, `version`.
- Computed on demand (results.service.ts:62-98 + packages/shared/src/psychometrics.ts): p (difficulty index), D (upper/lower 27%), corrected point-biserial, KR-20, SEM, simple distractor counts by option (`distribution`), flags. Gated by `MIN_CANDIDATES` = 30. So the docs/claims that item analysis exists are TRUE for a single exam; the engine is deterministic.

What is missing for proper item analysis:
1. No persistence of item statistics: nothing stored per (question, exam) or per question across exams, so no longitudinal difficulty/discrimination, no empirical difficulty fed back to `Question`, no item bank health view. Every analysis recomputes from raw answers (DB-08).
2. Distractor analysis is counts only; no upper/lower group breakdown per option, no omit rate by group, no "attractive distractor" flag (psychometrics.ts computes none).
3. Time per question: no question-view/dwell events exist; only save timestamps, so true time-on-item is not derivable (`visited` is a boolean). No per-question time in `attempt_events`.
4. Taxonomy: topic/subtopic are free-text on `Question`, there is no Topic/Syllabus table, no learning-outcome model, no mapping Course -> syllabus topics -> questions, no teaching-material model (grep of schema: none). `CurriculumDocument` is per Program with a URL only. Course has only code/title/semester/credits.
5. Metadata drift (DB-15): topic/difficulty/bloom not frozen at paper approval, no question version on `exam_questions`.
6. Marks: `Result` stores aggregate only (no per-section/per-topic subscores); per-question correctness is not stored, it must be recomputed from answers + key actions.
7. Cohort context: no stored cohort attributes beyond student institution/programme/semester/batchYear; no gender or prior attainment fields except `Student.gender` (free text) and `fatherName`, so fairness (DIF) analysis is limited. `Enrollment.term` and `Exam.term` are free-text strings (default "2026-SPRING", schema.prisma:654) matched by equality, which is a normalisation hazard.
8. Item analysis correctness bug DB-05 and memory pattern DB-08.

---

## 5. Controls verified as working (by code reading; not executed)
- Server-side deadline: all timing decisions use the DB clock (`NOW(3)`/`SYSDATE(3)`); client time is not an input (delivery.service.ts:243-251, :282-301, :356-360). Grace is 5 s (packages/shared/src/constants.ts:15).
- Save path: transactional, share lock vs seal lock, strictly-increasing revision, idempotent replay, journal in the same transaction, DB trigger backstop for sealed attempts, CHECK constraints.
- Double submit / reconnect: unique (examId, studentId), P2002 resume (:163), sealed-replay returns identical receipt (:350, :363-365); stale-tab protection via `activeClientId` + `clientEpoch`.
- Suspend/extend/resume: single guarded transaction per command on the exam row with an idempotency ledger (control.service.ts:command) and `stateVersion` optimistic check; per-attempt locks (`lockActive`).
- Outbox: state change, event row, audit row commit together (control/transition.ts:20-26); `SKIP LOCKED` publishers; Redis loss degrades to DB polling (events.service.ts:155-172).
- Reconciler: DB lease (`lifecycle_leases`), bounded retries, idempotent steps; API does not depend on it for deadline enforcement (lifecycle.service.ts header).
- Append-only enforcement via triggers on audit_logs, answer_events, exam_roster_versions, eligibility_overrides, exam_events (delivery fields only), question_versions; hash-chained audit log with canonical JSON.
- Frozen paper: snapshot + `correctLabel` written at approval inside a transaction (exams.service.ts:124-137); key never sent to candidates (`paperFor` strips it, delivery.service.ts:56-60); approver != submitter (exams.service.ts:117).
- Roster: versioned, hash-stamped, candidates revoked not deleted (exams.service.ts:161-193); eligibility override is append-only with trigger and CHECK.
- Scoring is deterministic and pure (exam-rules.ts:57-72); regrade is derived from immutable snapshot plus ordered key actions.
- Backup tool design: consistent snapshot, per-table fingerprints, checksum, trigger and append-only probe on restore (scripts/db-backup.mjs:111-196) - design only; see DB-04.
- Pool hygiene: idle timeout below Hostinger's wait_timeout, minimum idle 2, pinned time zone and strict mode (db-url.ts).
- Indexes versus hot queries (reviewed): attempts (examId,status), (status,deadlineAt), unique (examId,studentId); attempt_answers PK (attemptId, examQuestionId); results unique (examId, studentId); exam_events (examId,id) and (deliveryStatus,id). I found no missing index on a hot candidate-path query. Monitor candidate list is paginated at 100 (monitor.service.ts:133) but its search uses `LIKE '%term%'` on regNo/fullName (full scan within the exam's candidate set; acceptable at cohort size).

## 6. Could not verify
- Production database settings: isolation level, sql_mode, `max_user_connections`, binary logging, version (11.8 per docs), character set at server level (DB-11).
- Whether any backup has ever been restored from the PRODUCTION Hostinger database; any scheduled backup; encryption keys (DB-04).
- Runtime behaviour and performance: nothing was executed. Load and fault-test claims in docs/implementation-status.md and docs/audits/DATA_INTEGRITY_FINDINGS.md (PostgreSQL runs, 2,000 and 5,000 candidates; local MariaDB 1,000 candidates) were not reproduced.
- apps/web exam player, offline queue and receipt UI (not in scope; DB-13 may be partly mitigated there but grep found nothing).
- Seed code, test files, directory import services, teacher modules, notification/mail contents, `auth` module, kv.service beyond heartbeat/cleanup.
- The exact contents of outbox mail bodies (DB-22), and whether `Student.photo` and question images are served only to authorised roles.
- pg-to-mysql.mjs / pg-mysql-verify.mjs were read at header level only (92 + 58 lines); data equivalence of the conversion was not checked.
- Hostinger runtime behaviours (does `RUN_WORKERS=false` web-only deployment have an always-on worker or only a cron `reconcile` - a 120 s cron backstop cannot meet per-second expectations; code relies on lazy seal on heartbeat/start for individual candidates).
