import { describe, expect, it } from 'vitest';
import { bullConnection } from '../src/infra/queues.service';

describe('BullMQ Redis connection from REDIS_URL', () => {
  it('keeps TLS, username and password for rediss:// (Upstash)', () => {
    const c = bullConnection('rediss://default:p%40ss@happy-parrot-1.upstash.io:6379');
    expect(c).toMatchObject({ host: 'happy-parrot-1.upstash.io', port: 6379, username: 'default', password: 'p@ss', tls: { servername: 'happy-parrot-1.upstash.io' }, maxRetriesPerRequest: null });
  });

  it('uses plain TCP for redis:// and keeps the database index', () => {
    const c = bullConnection('redis://localhost:6380/2');
    expect(c).toMatchObject({ host: 'localhost', port: 6380, db: 2 });
    expect('tls' in c).toBe(false);
    expect(c.username).toBeUndefined();
    expect(c.password).toBeUndefined();
  });

  it('defaults the port and omits db 0', () => {
    const c = bullConnection('redis://:secret@cache');
    expect(c).toMatchObject({ port: 6379, password: 'secret' });
    expect('db' in c).toBe(false);
  });
});
