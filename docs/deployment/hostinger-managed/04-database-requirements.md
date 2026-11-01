# 04 — Database requirements

**PostgreSQL stays.** Hostinger's managed database is MySQL; it is not a candidate. The engine uses PostgreSQL features that have no drop-in equivalent: `clock_timestamp()` as the authoritative exam clock, `INSERT … ON CONFLICT … WHERE revision <` (revisioned idempotent saves), `SELECT … FOR UPDATE` and `SKIP LOCKED`, `pg_advisory_xact_lock`, PL/pgSQL triggers (append-only audit/answer journal, immutable sealed answers), partial unique indexes, `gen_random_uuid()`. `[CODE]`

## Requirements derived from the repository

| # | Requirement | Evidence | Why it matters |
|---|---|---|---|
| D1 | **PostgreSQL 16** (same major as development) | `docker-compose.yml`, CI image, backup tooling targets 16 | migrations and triggers are developed and tested on 16 |
| D2 | **TLS**, `sslmode=require` (or stricter) | `productionProblems()` refuses a `DATABASE_URL` without it | credentials and answers travel over the public internet from Hostinger |
| D3 | **Durable commits** (`synchronous_commit=on`) | exam-engine doc: "Saved" only after a durable commit | a managed service with async replicas only is fine; async *commit* is not |
| D4 | Connections: API `DB_POOL_MAX` (default 20) per process; worker adds its own pool | `config.ts` | size the provider's connection limit ≥ (API + worker + cron + migration) |
| D5 | **Pooler compatibility** | code uses interactive transactions and `pg_advisory_xact_lock` (transaction-scoped) and no `LISTEN/NOTIFY` or session advisory locks | transaction-mode pooling should work, but **named prepared statements are not tested through a pooler** `[NOT VERIFIED]` — test with the real pooler at staging, or connect directly within the connection limit |
| D6 | **Automated backups + point-in-time recovery** | RPO of a logical dump equals its interval (docs/operations/backup-restore.md) | exam day needs minutes, not a night |
| D7 | **Tested restore** | `npm run backup:verify` pattern (restore into a disposable cluster, compare fingerprints, check triggers, `GET /api/audit/verify`) | an untested backup is not a backup |
| D8 | Low latency to the Hostinger site | each answer save is one SQL round-trip plus the request | choose the provider region closest to the Hostinger data centre (**not obtained**: `[NOT VERIFIED]`) |
| D9 | Monitoring and alerting (connections, storage, replication/PITR health) | metrics rules exist for the app, not for the database | |
| D10 | Controlled migrations | `prisma migrate deploy`, never on boot | run from CI or a trusted workstation against the target, never from the Hostinger build |

## Environments (never share data or credentials between them)

| Env | Purpose | Data |
|---|---|---|
| development | engineers' machines | seed data, free to destroy |
| test | automated tests (`TEST_DATABASE_URL`), created and reset by the suites | synthetic |
| **staging** | rehearsal on the real topology | synthetic candidates only; separate service/instance and credentials |
| **production** | real examinations | **empty at schema level**; reference data and real people only |

**Never copy** development/test/load-test data into staging-with-real-people or production: the seed creates demo accounts with one shared password and the load tool creates thousands of synthetic candidates `[CODE]`. The seed refuses `NODE_ENV=production`; there is currently **no first-administrator bootstrap** command (blocker B-05).

## Provider evaluation (requirements, not brands)

Score any candidate against D1–D10; reject on a "no" for D1, D2, D6, D7.

| Question to put to a provider | Needed answer |
|---|---|
| PostgreSQL 16 available? | yes |
| TLS enforced, CA available? | yes |
| PITR retention window and restore time? | ≥ 7 days; documented; test-restored by us |
| Connection limit and pooler (mode, prepared statements)? | ≥ 60 direct, or a transaction pooler tested with Prisma + `pg` |
| Regions? | one near the Hostinger data centre |
| Storage and IOPS headroom for ~100 000 answer rows per 2 000 candidates plus a journal of the same size | yes |
| Price at the needed size, including egress and PITR | **not obtained — pricing is not asserted here** |
| Data residency / institutional policy | university decision |

Do not create an account or credentials without the account owner's authorisation (not done).
