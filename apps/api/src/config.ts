import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  COOKIE_SECRET: z.string().min(32),
  RECEIPT_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  DB_POOL_MAX: z.coerce.number().default(20),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('oes-artifacts'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(1025),
  MAIL_FROM: z.string().default('SZABMU Examinations <exams@szabmu.example>'),
  DEV_EXPOSE_CODES: z.enum(['true', 'false']).default('false'),
  RUN_WORKERS: z.enum(['true', 'false']).default('true'),
  /** Must be 'true' behind a load balancer/reverse proxy so req.ip (rate limits, audit) is the client's, not the proxy's. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});

export type Config = z.infer<typeof schema>;

const WEAK_SECRET = /dev-only|change-?me|example|ci-only|fault-test|password|secret-?key|0123456789|test-secret/i;

/** Violations that make a PRODUCTION configuration unsafe. Pure function so it can be unit-tested exhaustively. */
export function productionProblems(cfg: Config, env: NodeJS.ProcessEnv = process.env): string[] {
  const p: string[] = [];
  if (cfg.DEV_EXPOSE_CODES === 'true') p.push('DEV_EXPOSE_CODES must be false (it returns password-reset codes in API responses)');
  for (const k of ['COOKIE_SECRET', 'RECEIPT_SECRET'] as const) {
    const v = cfg[k];
    if (WEAK_SECRET.test(v)) p.push(`${k} looks like a development/example value`);
    if (new Set(v).size < 12) p.push(`${k} has too little entropy (use ≥32 random characters, e.g. \`openssl rand -base64 48\`)`);
  }
  if (cfg.COOKIE_SECRET === cfg.RECEIPT_SECRET) p.push('COOKIE_SECRET and RECEIPT_SECRET must differ');
  const origins = cfg.WEB_ORIGIN.split(',').map((o) => o.trim());
  for (const o of origins) { if (!/^https:\/\//.test(o)) p.push(`WEB_ORIGIN "${o}" must be https:// in production (session cookies are Secure)`); if (/localhost|127\.0\.0\.1/.test(o)) p.push(`WEB_ORIGIN "${o}" must not be localhost in production`); }
  let db: URL | null = null; try { db = new URL(cfg.DATABASE_URL); } catch { p.push('DATABASE_URL is not a valid URL'); }
  if (db) {
    if (!db.password) p.push('DATABASE_URL must include a password');
    if (/oes_dev_password/.test(cfg.DATABASE_URL)) p.push('DATABASE_URL uses the development password');
    if (!/sslmode=(require|verify-ca|verify-full)/.test(cfg.DATABASE_URL) && env.DB_ALLOW_PLAINTEXT !== 'true') p.push('DATABASE_URL must set sslmode=require (or verify-full); set DB_ALLOW_PLAINTEXT=true only for a private network you have accepted in writing');
  }
  try { const r = new URL(cfg.REDIS_URL); if (!r.password && r.protocol !== 'rediss:' && env.REDIS_ALLOW_NOAUTH !== 'true') p.push('REDIS_URL must carry a password (or use rediss://); set REDIS_ALLOW_NOAUTH=true only for an isolated network'); } catch { p.push('REDIS_URL is not a valid URL'); }
  if (cfg.S3_SECRET_KEY && /oes_dev_minio/.test(cfg.S3_SECRET_KEY + (cfg.S3_ACCESS_KEY ?? ''))) p.push('S3 credentials are the development MinIO defaults');
  if (cfg.TRUST_PROXY !== 'true' && env.ALLOW_NO_PROXY !== 'true') p.push('TRUST_PROXY=true is required behind a load balancer (otherwise every client shares the proxy IP for rate limiting and audit); set ALLOW_NO_PROXY=true if the API is directly exposed');
  if (cfg.SESSION_TTL_HOURS > 24) p.push('SESSION_TTL_HOURS must be ≤ 24 in production');
  return p;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = schema.parse(env);
  if (cfg.NODE_ENV === 'production') {
    const problems = productionProblems(cfg, env);
    if (problems.length) throw new Error(`Unsafe production configuration:\n - ${problems.join('\n - ')}`);
  }
  return cfg;
}
export const CONFIG = Symbol('CONFIG');
