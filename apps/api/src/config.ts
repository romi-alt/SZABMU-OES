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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = schema.parse(env);
  if (cfg.NODE_ENV === 'production') {
    if (cfg.DEV_EXPOSE_CODES === 'true') throw new Error('DEV_EXPOSE_CODES must be false in production');
    if (/dev-only/.test(cfg.COOKIE_SECRET + cfg.RECEIPT_SECRET)) throw new Error('Development secrets must not be used in production');
  }
  return cfg;
}
export const CONFIG = Symbol('CONFIG');
