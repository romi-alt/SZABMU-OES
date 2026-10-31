import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) with RFC 4648 base32 secrets — no third-party dependency. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase(); let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { const i = ALPHABET.indexOf(ch); if (i < 0) throw new Error('invalid base32'); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest(); const o = h[h.length - 1]! & 0x0f;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}
export const totpAt = (secretB32: string, atMs: number, digits = 6) => hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / TOTP_PERIOD), digits);

/**
 * Returns the matched time-step (counter) or null. Accepts ±`window` steps for clock drift and only steps strictly after
 * `lastStep`, so a code (or an earlier one) cannot be replayed.
 */
export function verifyTotp(secretB32: string, code: string, nowMs: number, lastStep: number | null, window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32); const now = Math.floor(nowMs / 1000 / TOTP_PERIOD); let hit: number | null = null;
  for (let d = -window; d <= window; d++) {
    const step = now + d; const exp = Buffer.from(hotp(secret, step)); const got = Buffer.from(code);
    if (timingSafeEqual(exp, got) && (lastStep === null || step > lastStep) && (hit === null || step > hit)) hit = step; // no early return: constant work
  }
  return hit;
}
export const otpauthUrl = (secretB32: string, account: string, issuer = 'SZABMU OES') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;
