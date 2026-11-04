import { Prisma } from '../generated/prisma/client';

/**
 * A list of ids (or other short keys) as a derived table, bound as ONE JSON parameter however long the list is (MySQL has no array parameters and
 * caps a statement at 65 535 placeholders). The explicit collation matches the tables, so comparing against a column never
 * fails with "illegal mix of collations". Use as `WHERE x IN ${idList(ids)}`.
 */
export function idList(ids: readonly string[]): Prisma.Sql {
  return Prisma.sql`(SELECT j.v FROM JSON_TABLE(${JSON.stringify(ids)}, '$[*]' COLUMNS (v VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$')) AS j)`;
}

/** A JSON column that holds a list of strings (tags, question order, selected candidate ids). */
export function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/** A JSON column read through raw SQL: MariaDB stores JSON as LONGTEXT, so the text protocol may hand back the serialised string. */
export function json<T = unknown>(v: unknown): T {
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}

/** InnoDB picked this transaction as a deadlock victim (MySQL 1213 / Prisma P2034): it was rolled back in full and is safe to re-run. */
export function isDeadlock(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e); const code = (e as { code?: string })?.code;
  return code === 'P2034' || /Deadlock found|\(conn=\d+, no: 1213|errno: 1213|try restarting transaction/i.test(m);
}

/** Runs a whole transaction again (up to `tries` times, short jittered back-off) when it lost a deadlock. */
export async function retryOnDeadlock<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !isDeadlock(e)) throw e;
      await new Promise((r) => setTimeout(r, 15 * i + Math.random() * 25));
    }
  }
}

/** COUNT(*) and friends come back from MySQL as BIGINT; every count in this application fits a JS number. */
export function int(v: bigint | number | string | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v);
}
