/** Phone numbers: optional leading +, then digits with common separators; 7–15 digits (E.164 upper bound). Empty means "not provided". */
export const PHONE_HINT = 'Use digits only, with an optional leading + (spaces, dashes and brackets are allowed), e.g. +92 300 1234567.';
export function isValidPhone(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s === '') return true;
  if (!/^(\+|\()?[0-9][0-9 ()\-.]*$/.test(s)) return false;
  const digits = s.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}
