import { describe, expect, it } from 'vitest';
import { isValidPhone } from './phone';

describe('isValidPhone', () => {
  it.each(['', '  ', '+92 300 1234567', '0300-1234567', '(021) 3456 7890', '03001234567'])('accepts %j', (v) => expect(isValidPhone(v)).toBe(true));
  it.each(['abc', '12345', '+', '++923001234567', '0300-abc-1234', '1'.repeat(16), '<script>', '12 34 x 567890'])('rejects %j', (v) => expect(isValidPhone(v)).toBe(false));
  it('rejects non-strings', () => { expect(isValidPhone(undefined)).toBe(false); expect(isValidPhone(5)).toBe(false); });
});
