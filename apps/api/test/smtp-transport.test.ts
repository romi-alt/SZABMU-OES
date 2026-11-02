import { describe, expect, it } from 'vitest';
import { smtpTransportOptions } from '../src/infra/mail.service';

const base = { SMTP_HOST: 'smtp.hostinger.com', NODE_ENV: 'development' as const, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_SECURE: undefined };

describe('SMTP transport options', () => {
  it('keeps the unauthenticated dev relay (Mailpit) lenient', () => {
    const o = smtpTransportOptions({ ...base, SMTP_HOST: 'mailpit', SMTP_PORT: 1025 });
    expect(o).toMatchObject({ secure: false, auth: undefined, requireTLS: false, tls: { rejectUnauthorized: false } });
  });

  it('uses implicit TLS with verified certificates and AUTH on port 465', () => {
    const o = smtpTransportOptions({ ...base, SMTP_PORT: 465, SMTP_USER: 'no-reply@szabmu.site', SMTP_PASS: 'x' });
    expect(o).toMatchObject({ secure: true, auth: { user: 'no-reply@szabmu.site', pass: 'x' }, requireTLS: false, tls: { rejectUnauthorized: true } });
  });

  it('requires STARTTLS on 587 whenever credentials are sent, even outside production', () => {
    const o = smtpTransportOptions({ ...base, SMTP_PORT: 587, SMTP_USER: 'u', SMTP_PASS: 'p' });
    expect(o).toMatchObject({ secure: false, requireTLS: true, tls: { rejectUnauthorized: true } });
  });

  it('honours an explicit SMTP_SECURE', () => {
    expect(smtpTransportOptions({ ...base, SMTP_PORT: 2525, SMTP_SECURE: 'true' }).secure).toBe(true);
    expect(smtpTransportOptions({ ...base, SMTP_PORT: 465, SMTP_SECURE: 'false' }).secure).toBe(false);
  });

  it('does not send AUTH when only one of user/password is set', () => {
    expect(smtpTransportOptions({ ...base, SMTP_PORT: 587, SMTP_USER: 'u' }).auth).toBeUndefined();
  });
});
