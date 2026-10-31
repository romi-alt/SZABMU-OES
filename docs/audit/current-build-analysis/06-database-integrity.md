# 06 — Database integrity

PostgreSQL 16, Prisma 7 + `@prisma/adapter-pg`. 35 models. Evidence: schema/migrations (SOURCE), 171 API tests + 3 backup tests + 10 fault assertions (TODAY).

## Integrity mechanisms (verified TODAY by tests unless noted)

| Mechanism | Where | Evidence |
|---|---|---|
| Atomic revisioned answer upsert + journal in one statement | `delivery.service.ts:162-205` | `exam-engine.test.ts`, fault suite; 250 k acked answers verified under load (HISTORICAL) |
| DB-clock deadline (`clock_timestamp()`), grace `SAVE_GRACE_SECONDS` | `delivery.service.ts:171` | e2e clock-manipulation spec PASS; engine tests |
| Idempotent submit; order-independent `answerDigest`; HMAC receipt | `finalize()` `:264-330` | engine tests; fault "lost response" test PASS |
| `FOR KEY SHARE` on saves vs `FOR UPDATE` on submit; submit reads answers in a *separate* statement after the lock (READ COMMITTED snapshot semantics) | `:294` | `submit-contention.test.ts` PASS (3-connection pool, 80 candidates) |
| Append-only triggers: `answer_events`, `attempt_events`, `audit_logs`, `eligibility_overrides` | migrations | backup verify `auditAppendOnly: true`; security tests |
| Hash-chained audit log; verify endpoint | `audit.service.ts`, `GET /audit/verify` | e2e CCE spec PASS; restored-backup chain verified (PASS) |
| Frozen paper snapshots (`exam_questions.snapshot`), frozen admission decision on `attempts.admission` | schema | eligibility tests (15) |
| Unique `(examId, studentId)` attempts; double-start resolves to the winner (`P2002` fall-through) | `delivery.service.ts:129` | engine tests |
| Result unique `(examId, studentId)`; certificate serial from a sequence | schema, `results.service.ts:166` | workflow tests |

## Backup and restore (TODAY, `backup-restore.test.ts`, 3/3 PASS)

`scripts/db-backup.mjs`: snapshot-consistent `pg_dump` taken **while candidates write**, manifest with per-table counts + order-independent content fingerprints, restore into a disposable cluster, then verification (checksum, content, migrations, triggers, append-only, API boots on the restored DB, audit chain intact, sealed receipt present). A corrupted dump and a tampered manifest are rejected.

**Not covered**: scheduling, retention, encryption at rest/in transit, off-site copy, PITR/WAL archiving, restore-time measurement at scale, backup of Redis (not needed for truth), access control around backups.

## Risks

- `answer_events` is an unpartitioned, ever-growing journal (≈ 1 row/save, ≈ 1 M rows for 20,000 × 50); no retention/partitioning. HISTORICAL note, consistent with schema.
- Answer keys (`exam_questions.correctLabel` and snapshots) are **plaintext at rest** (policy P-27); API responses never expose them (`key-confidentiality.test.ts`, 2 PASS) but a DB read does.
- `docker-compose`/stock PostgreSQL settings (128 MB `shared_buffers`, `max_connections=100`) are what all load numbers were taken with; no tuned configuration, no PgBouncer.
- Dev DB contains load-test residue (12 k students, LIVE `LOAD-*` exams).
- Migration risk: migrations were only ever applied to fresh/disposable clusters and the shared dev DB (no production data exists).
