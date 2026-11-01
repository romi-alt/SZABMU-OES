export interface PasswordCheck { ok: boolean; score: 0 | 1 | 2 | 3 | 4; problems: string[] }

/** Password policy (see docs/policy-decisions.md P-03). Min 10 chars, 3 of 4 classes, no obvious patterns. */
export function checkPassword(pw: string, personal: string[] = []): PasswordCheck {
  const problems: string[] = [];
  if (pw.length < 10) problems.push('Use at least 10 characters.');
  if (pw.length > 128) problems.push('Use at most 128 characters.');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) problems.push('Mix at least three of: lowercase, uppercase, digits, symbols.');
  const lower = pw.toLowerCase();
  if (/(.)\1{3,}/.test(pw)) problems.push('Avoid long repeated characters.');
  if (['password', 'qwerty', '123456', 'szabmu', 'pims'].some((w) => lower.includes(w))) problems.push('Avoid common words.');
  for (const p of personal) if (p.length >= 4 && lower.includes(p.toLowerCase())) problems.push('Do not include your name or email.');
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (classes >= 3) score++;
  if (classes === 4) score++;
  return { ok: problems.length === 0, score: Math.min(4, score) as 0 | 1 | 2 | 3 | 4, problems };
}
