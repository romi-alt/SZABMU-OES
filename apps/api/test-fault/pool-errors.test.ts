import { describe, expect, it } from 'vitest';
import { PoolErrorPolicy } from './pool-errors';

const err = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});

describe('PoolErrorPolicy (harness self-test; needs no database)', () => {
  it('accepts connection loss during a declared outage and records it as expected', () => {
    const p = new PoolErrorPolicy(); p.beginOutage();
    p.handler(err('Connection terminated unexpectedly')); p.handler(err('x', 'ECONNRESET')); p.handler(err('the database system is in recovery mode', '57P03'));
    expect(p.expected).toHaveLength(3); expect(p.unexpected).toHaveLength(0);
    expect(() => p.assertClean()).not.toThrow();
  });

  it('fails the run for a connection error when NO outage was declared', () => {
    const p = new PoolErrorPolicy();
    p.handler(err('Connection terminated unexpectedly'));
    expect(p.unexpected).toHaveLength(1);
    expect(() => p.assertClean()).toThrow(/unexpected database connection errors \(1\)/);
  });

  it('fails the run for a non-connection error even during an outage', () => {
    const p = new PoolErrorPolicy(); p.beginOutage();
    p.handler(err('permission denied for table attempts', '42501'));
    expect(() => p.assertClean()).toThrow(/permission denied/);
  });

  it('the outage window closes: a connection error after endOutage() is unexpected', () => {
    const p = new PoolErrorPolicy(); p.beginOutage(); p.handler(err('Connection terminated unexpectedly')); p.endOutage();
    expect(() => p.assertClean()).not.toThrow();
    p.handler(err('Connection terminated unexpectedly'));
    expect(() => p.assertClean()).toThrow();
  });
});
