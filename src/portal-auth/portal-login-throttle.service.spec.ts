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
        return next;
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
});
