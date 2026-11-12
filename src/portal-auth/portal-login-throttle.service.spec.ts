import { HttpStatus } from '@nestjs/common';
import { PortalLoginThrottleService } from './portal-login-throttle.service';

interface RedisMock {
  eval: jest.Mock;
  del: jest.Mock;
}

describe('PortalLoginThrottleService', () => {
  let counts: Map<string, number>;
  let redis: RedisMock;
  let service: PortalLoginThrottleService;

  beforeEach(() => {
    counts = new Map<string, number>();
    redis = {
      eval: jest.fn(async (_script, _keyCount, key: string) => {
        const next = (counts.get(key) || 0) + 1;
        counts.set(key, next);
        return [next, 900];
      }),
      del: jest.fn(async (...keys: string[]) => {
        keys.forEach((key) => counts.delete(key));
        return keys.length;
      }),
    };
    service = new PortalLoginThrottleService(redis as never);
  });

  it('blocks an email after ten failed attempts in the window', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        service.consume('127.0.0.1', 'user@example.com'),
      ).resolves.toBeUndefined();
    }

    await expect(
      service.consume('127.0.0.1', 'user@example.com'),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('clears both email and IP counters after successful login', async () => {
    await service.consume('127.0.0.1', 'user@example.com');
    await service.reset('127.0.0.1', 'user@example.com');

    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(counts.size).toBe(0);
  });

  it('applies an independent 50-attempt IP budget to OAuth without consuming password counters', async () => {
    for (let attempt = 0; attempt < 50; attempt++) await service.consumeOAuth('203.0.113.10');
    await expect(service.consumeOAuth('203.0.113.10')).rejects.toMatchObject({ status: 429, response: { retryAfter: 900 } });
    await expect(service.consumeOAuth('203.0.113.11')).resolves.toBeUndefined();
    await expect(service.consume('203.0.113.10', 'user@example.com')).resolves.toBeUndefined();
    await service.reset('203.0.113.10', 'user@example.com');
    await expect(service.consumeOAuth('203.0.113.10')).rejects.toMatchObject({ status: 429 });
  });

  it('reports the remaining lifetime of the blocked bucket rather than a fresh 15-minute wait', async () => {
    redis.eval.mockImplementation(async (_script, _keyCount, key) => key.includes(':email:') ? [11, 37] : [2, 800]);
    await expect(service.consume('203.0.113.10', 'user@example.com')).rejects.toMatchObject({ status: 429, response: { retryAfter: 37 } });
  });

  it('keeps the existing aggregate password IP limit across different accounts', async () => {
    for (let attempt = 0; attempt < 50; attempt++) await service.consume('203.0.113.10', `user${attempt}@example.com`);
    await expect(service.consume('203.0.113.10', 'another@example.com')).rejects.toMatchObject({ status: 429 });
  });
});

describe('OAuth throttle Redis script', () => {
  const RedisMock = require('ioredis-mock');
  it('expires counters and repairs a counter without TTL', async () => {
    const redis = new RedisMock();
    try {
      const service = new PortalLoginThrottleService(redis);
      await service.consumeOAuth('203.0.113.20');
      const [key] = await redis.keys('portal:oauth:start:ip:*');
      expect(await redis.ttl(key)).toBeGreaterThan(0);
      await redis.set(key, '50');
      expect(await redis.ttl(key)).toBe(-1);
      await expect(service.consumeOAuth('203.0.113.20')).rejects.toMatchObject({ status: 429, response: { retryAfter: 900 } });
      expect(await redis.ttl(key)).toBeGreaterThan(0);
    } finally { redis.disconnect(); }
  });
});
