/**
 * Connection-error policy for the fault harness.
 *
 * When a test deliberately crashes the disposable PostgreSQL, every idle client in the harness's own pg.Pool is disconnected and
 * pg emits 'error'. That is EXPECTED — but only while an outage that the test itself declared is in progress, and only for
 * connection-loss errors. Everything else (a connection error with no declared outage, or any non-connection error) is recorded
 * and fails the suite via `assertClean()`. Nothing is swallowed silently.
 */
export class PoolErrorPolicy {
  private outage = false;
  readonly expected: string[] = [];
  readonly unexpected: Error[] = [];

  /** The test is about to crash/stop the database on purpose. */
  beginOutage() { this.outage = true; }
  /** The database is back (accepting connections again). */
  endOutage() { this.outage = false; }

  static isConnectionLoss(e: unknown): boolean {
    const x = e as { code?: string; message?: string } | null;
    if (!x) return false;
    return ['57P01', '57P02', '57P03', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(x.code ?? '') || /Connection terminated|terminating connection|server closed the connection|the database system is (starting up|in recovery|shutting down)/i.test(x.message ?? '');
  }

  /** Attach as `pool.on('error', policy.handler)` (also usable for a Client). */
  readonly handler = (e: Error) => {
    if (this.outage && PoolErrorPolicy.isConnectionLoss(e)) this.expected.push(e.message);
    else this.unexpected.push(e);
  };

  /** Throws (so the test run fails) if anything unexpected was seen. */
  assertClean() {
    if (this.unexpected.length) throw new Error(`unexpected database connection errors (${this.unexpected.length}): ${this.unexpected.map((e) => e.message).join(' | ')}`);
  }
}
