import mariadb from 'mariadb';

/** Direct database access for the few specs that move server-side state (deadlines) or check what was stored. */
const DB_URL = process.env.DATABASE_URL ?? 'mysql://oes:oes_dev_password@127.0.0.1:3307/szabmu_oes';

/** Runs one statement and returns its rows. The session matches the API's (UTC clock, "double-quoted" identifiers). */
export async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const u = new URL(DB_URL); const accept = u.searchParams.get('sslaccept');
  const conn = await mariadb.createConnection({
    host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)), ssl: accept ? { rejectUnauthorized: accept === 'strict' } : undefined,
    connectTimeout: 10_000, bigIntAsNumber: true, decimalAsNumber: true,
    initSql: ["SET time_zone = '+00:00'", "SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')"],
  });
  try { return (await conn.query(query, params)) as T[]; } finally { await conn.end(); }
}
