# Database connectivity

## How the code connects `[CODE]`
`PrismaService` uses Prisma 7 with the `pg` driver adapter and a pool of `DB_POOL_MAX` (default 20). `DATABASE_URL` is the only setting. `prisma.config.ts` reads the same variable for `prisma migrate deploy`. Production refuses a URL that lacks a password, uses the development password, or lacks `sslmode=require|verify-ca|verify-full` (unless `DB_ALLOW_PLAINTEXT=true`, for isolated networks only).

## Connection rules for the managed topology
| Process | Pool | Notes |
|---|---|---|
| API on Hostinger | ≤ 20 (use 10–15 until measured) | one site, one process |
| Worker (external) | ≤ 10 | lifecycle + BullMQ consumers |
| Reconcile cron | ≤ 5 | finite |
| Migration job | 1 | run from CI or a workstation, **never** from the Hostinger build |

Total concurrent connections ≤ the provider's limit with headroom. A connection pooler in **transaction mode** is plausible (the code uses interactive transactions and `pg_advisory_xact_lock`, no session advisory locks, no `LISTEN/NOTIFY`) but **named prepared statements through a pooler have not been tested** `[NOT VERIFIED]`: staging test required; if it fails, connect directly. Migrations need a **direct** connection (set `DATABASE_URL` to the direct URL for the migration job only).

## TLS
`sslmode=require` is what the gate checks. Recent `pg` versions treat `require`/`prefer`/`verify-ca` as `verify-full`, i.e. the server certificate must chain to a CA Node trusts and match the host `[NOT VERIFIED — confirm against the installed `pg` version]`. A provider with a private CA needs that CA supplied (`NODE_EXTRA_CA_CERTS` or `sslrootcert`). Test from the **actual Hostinger site**, not a laptop.

## Connectivity smoke test (staging, from a Hostinger site or the worker host)
```
psql "$DATABASE_URL" -c "select version(), now(), clock_timestamp(), current_setting('ssl')"
GET https://<api-site>/api/health     # {"db":true,...}
```
Expected: PostgreSQL 16, `ssl = on`, health `db: true`, round-trip well under 20 ms from the API's region (record the measured value; each answer save is one statement).

## Failure behaviour already tested by the project `[CODE]`
`apps/api/test-fault/pool-errors.test.ts` (pool error policy), `fault.test.ts` (PostgreSQL crash/recovery, answers acknowledged before a crash are present after it), `backup-restore.test.ts`. These ran on a disposable local cluster in the other session; **not re-run here** (the sandbox could not install dependencies). They exercise the engine, not the Hostinger↔provider network path.

## Reliability requirements for the provider (summary)
TLS enforced; PITR with a tested restore; synchronous durable commit; connection limit sized above the total; monitoring/alerts; region near Hostinger's data centre (**not obtained**); separate instances for staging and production.
