import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** AES-256-GCM envelope for small secrets at rest (TOTP seeds). Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
const key = (material: string) => Buffer.from(hkdfSync('sha256', material, 'oes-secretbox-salt', 'oes-mfa-v1', 32));
export function seal(plain: string, material: string): string {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key(material), iv); const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
export function open(boxed: string, material: string): string {
  const [v, iv, tag, ct] = boxed.split('.'); if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported secret format');
  const d = createDecipheriv('aes-256-gcm', key(material), Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
