import type { PoolConfig } from 'mariadb';

/**
 * Every pooled connection runs these first.
 * - time_zone: DATETIME columns carry no zone; Prisma reads and writes them as UTC, so the session clock (NOW(), CURRENT_TIMESTAMP)
 *   must be UTC too or database-side timing decisions would drift by the server's offset.
 * - ANSI_QUOTES: hand-written SQL quotes camelCase identifiers with "double quotes" (string literals always use single quotes).
 *   Prisma's own queries use backticks, which keep working.
 * - STRICT_TRANS_TABLES: reject truncation/invalid values instead of silently coercing them (Hostinger's default sql_mode is not strict).
 */
export const SESSION_INIT_SQL = [
  "SET time_zone = '+00:00'",
  "SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES', 'STRICT_TRANS_TABLES')",
];

/** True when DATABASE_URL asks for an encrypted connection (Prisma's MySQL parameter `sslaccept`, or a libpq-style `sslmode`). */
export function dbUrlRequiresTls(url: string): boolean {
  return /[?&](sslaccept=(strict|accept_invalid_certs)|sslmode=(require|verify-ca|verify-full))\b/.test(url);
}

/** mysql://user:pass@host:port/db?sslaccept=strict → mariadb pool options. */
export function poolConfigFromUrl(url: string, extra: Partial<PoolConfig> = {}): PoolConfig {
  const u = new URL(url);
  if (!/^(mysql|mariadb):$/.test(u.protocol)) throw new Error(`DATABASE_URL must be a mysql:// URL (got ${u.protocol}//)`);
  const q = u.searchParams;
  const accept = q.get('sslaccept') ?? ({ 'verify-full': 'strict', 'verify-ca': 'strict', require: 'accept_invalid_certs' } as Record<string, string>)[q.get('sslmode') ?? ''];
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    ...(accept ? { ssl: { rejectUnauthorized: accept === 'strict' } } : {}),
    connectTimeout: Number(q.get('connect_timeout') ?? 10) * 1000,
    initSql: SESSION_INIT_SQL,
    // Hostinger closes connections idle for 300 s (wait_timeout); release them first so the pool never hands out a dead socket.
    idleTimeout: 240,
    // The driver would otherwise refill every released slot at once (minimumIdle defaults to the pool size), re-creating up to
    // connectionLimit connections every idleTimeout — and Hostinger allows only 500 NEW connections per hour per user.
    minimumIdle: 2,
    ...extra,
  };
}
