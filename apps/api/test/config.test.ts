import { describe, expect, it } from 'vitest';
import { loadConfig, productionProblems } from '../src/config';

const GOOD: NodeJS.ProcessEnv = {
  NODE_ENV: 'production', DATABASE_URL: 'mysql://oes:Xk9fQ2mV7pLr4TzWb8Nc@db.internal:3306/oes?sslaccept=strict', REDIS_URL: 'rediss://:h7Qm2Zp9Xv4Lk8Wt@cache.internal:6380',
  WEB_ORIGIN: 'https://exams.example-university.test', COOKIE_SECRET: 'q8R!vK2#mZp9$Lw4Xc7&Tb5Nj3^Hd6Fg', RECEIPT_SECRET: 'W3t@Yp8*Ke1%Ua6+Os9=Ij2~Gb5?Vn4Rz', TRUST_PROXY: 'true', DEV_EXPOSE_CODES: 'false',
  PORTAL_ENFORCE: 'true', MFA_ENFORCE: 'true', MFA_KEY: 'M7!kR2$vXq9&Lp4#Wz6^Tb8*Nc3@Hd5Y', METRICS_TOKEN: 'Zt4#nQ8@vLw2$Xb6&Hk9!Ps3^Rc7*Df5',
};
const with_ = (o: NodeJS.ProcessEnv) => ({ ...GOOD, ...o });

describe('production configuration validation', () => {
  it('accepts a strong configuration', () => { expect(() => loadConfig(GOOD)).not.toThrow(); });

  it('Redis is optional: unset or empty REDIS_URL selects the database backend and is not a problem', () => {
    expect(loadConfig(with_({ REDIS_URL: undefined })).REDIS_URL).toBeUndefined();
    expect(loadConfig(with_({ REDIS_URL: '' })).REDIS_URL).toBeUndefined();   // hPanel may keep a key with an empty value
  });

  it.each([
    ['DEV_EXPOSE_CODES=true', { DEV_EXPOSE_CODES: 'true' }, /DEV_EXPOSE_CODES/],
    ['development cookie secret', { COOKIE_SECRET: 'dev-only-cookie-secret-change-me-0123456789' }, /COOKIE_SECRET looks like/],
    ['example receipt secret', { RECEIPT_SECRET: 'receipt-secret-example-aaaaaaaaaaaaaaaaaaaa' }, /RECEIPT_SECRET looks like/],
    ['low-entropy secret', { COOKIE_SECRET: 'a'.repeat(40) }, /too little entropy/],
    ['identical secrets', { RECEIPT_SECRET: GOOD.COOKIE_SECRET }, /must differ/],
    ['http origin', { WEB_ORIGIN: 'http://exams.example-university.test' }, /must be https/],
    ['localhost origin', { WEB_ORIGIN: 'https://localhost:3000' }, /must not be localhost/],
    ['dev database password', { DATABASE_URL: 'mysql://oes:oes_dev_password@db.internal:3306/oes?sslaccept=strict' }, /development password/],
    ['database without password', { DATABASE_URL: 'mysql://oes@db.internal:3306/oes?sslaccept=strict' }, /must include a password/],
    ['database without TLS', { DATABASE_URL: 'mysql://oes:Xk9fQ2mV7pLr4TzWb8Nc@db.internal:3306/oes' }, /sslaccept=strict/],
    ['unauthenticated redis', { REDIS_URL: 'redis://cache.internal:6379' }, /REDIS_URL must carry a password/],
    ['dev MinIO credentials', { S3_ACCESS_KEY: 'oes_dev_minio', S3_SECRET_KEY: 'oes_dev_minio_secret' }, /development MinIO/],
    ['proxy trust missing', { TRUST_PROXY: 'false' }, /TRUST_PROXY=true is required/],
    ['MFA not enforced', { MFA_ENFORCE: 'false' }, /MFA_ENFORCE=true is required/],
    ['portals not enforced', { PORTAL_ENFORCE: 'false' }, /PORTAL_ENFORCE=true is required/],
    ['raised sign-in rate limit (test-only knob)', { LOGIN_RATE_IP_MAX: '5000' }, /must be left at their defaults/],
    ['raised per-account sign-in limit (test-only knob)', { LOGIN_RATE_ID_MAX: '500' }, /must be left at their defaults/],
    ['MFA key missing', { MFA_KEY: undefined }, /MFA_KEY .* is required/],
    ['MFA key reused from another secret', { MFA_KEY: GOOD.COOKIE_SECRET }, /MFA_KEY must be a distinct/],
    ['metrics token missing', { METRICS_TOKEN: undefined }, /METRICS_TOKEN .* is required/],
    ['very long sessions', { SESSION_TTL_HOURS: '72' }, /SESSION_TTL_HOURS/],
  ])('refuses to boot with %s', (_name, override, re) => {
    expect(() => loadConfig(with_(override))).toThrow(re);
  });

  it('reports every problem at once and never echoes secret values', () => {
    try { loadConfig(with_({ COOKIE_SECRET: 'dev-only-cookie-secret-change-me-0123456789', WEB_ORIGIN: 'http://localhost:3000', DEV_EXPOSE_CODES: 'true' })); expect.unreachable(); }
    catch (e) { const m = String((e as Error).message); expect(m.match(/\n - /g)!.length).toBeGreaterThanOrEqual(3); expect(m).not.toContain('dev-only-cookie-secret'); expect(m).not.toContain('Xk9fQ2mV7pLr4TzWb8Nc'); }
  });

  it('explicit, named escape hatches exist for private networks (and only those)', () => {
    expect(() => loadConfig(with_({ DATABASE_URL: 'mysql://oes:Xk9fQ2mV7pLr4TzWb8Nc@db.internal:3306/oes', DB_ALLOW_PLAINTEXT: 'true' }))).not.toThrow();
    expect(() => loadConfig(with_({ TRUST_PROXY: 'false', ALLOW_NO_PROXY: 'true' }))).not.toThrow();
  });

  it('non-production environments are not constrained (development secrets are fine locally)', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'mysql://oes:oes_dev_password@localhost:3307/x', REDIS_URL: 'redis://localhost:6390', COOKIE_SECRET: 'dev-only-cookie-secret-change-me-0123456789', RECEIPT_SECRET: 'dev-only-receipt-secret-change-me-0123456789' })).not.toThrow(); // MFA off by default outside production
    expect(productionProblems(loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'x://y', REDIS_URL: 'redis://localhost', COOKIE_SECRET: 'dev-only-cookie-secret-change-me-0123456789', RECEIPT_SECRET: 'dev-only-receipt-secret-change-me-0123456789' }), {}).length).toBeGreaterThan(0);
  });
});
