import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 15 * 60;
const EMAIL_ATTEMPT_LIMIT = 10;
const IP_ATTEMPT_LIMIT = 50;
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

@Injectable()
export class PortalLoginThrottleService {
  private readonly logger = new Logger(PortalLoginThrottleService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(ip: string | undefined, email: string): Promise<void> {
    const keys = this.getKeys(ip, email);
    await this.consumeLimits([{ key: keys.email, limit: EMAIL_ATTEMPT_LIMIT }, { key: keys.ip, limit: IP_ATTEMPT_LIMIT }]);
  }

  /** OAuth has no email identity yet; do not apply the password email limit to a shared IP. */
  async consumeOAuth(ip: string | undefined): Promise<void> {
    const ipHash = createHash('sha256').update(ip || 'unknown').digest('hex');
    await this.consumeLimits([{ key: `portal:oauth:start:ip:${ipHash}`, limit: IP_ATTEMPT_LIMIT }]);
  }

  private async consumeLimits(limits: Array<{ key: string; limit: number }>): Promise<void> {
    try {
      const results = await Promise.all(limits.map(async ({ key, limit }) => ({ ...await this.increment(key), limit })));
      const blocked = results.filter(result => result.count > result.limit);
      if (blocked.length) {
        throw new HttpException(
          { message: 'Too many login attempts. Try again later.', retryAfter: Math.max(...blocked.map(result => result.retryAfter)) },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        throw error;
      }
      this.logger.warn(
        `Portal login throttling unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async reset(ip: string | undefined, email: string): Promise<void> {
    const keys = this.getKeys(ip, email);
    try {
      await this.redis.del(keys.email, keys.ip);
    } catch (error) {
      this.logger.warn(
        `Unable to reset portal login throttle: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async increment(key: string): Promise<{ count: number; retryAfter: number }> {
    const [count, ttl] = await this.redis.eval(INCREMENT_SCRIPT, 1, key, WINDOW_SECONDS) as [number, number];
    return { count: Number(count), retryAfter: Math.max(1, Math.min(WINDOW_SECONDS, Number(ttl) || WINDOW_SECONDS)) };
  }

  private getKeys(
    ip: string | undefined,
    email: string,
  ): { email: string; ip: string } {
    const emailHash = createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');
    const ipHash = createHash('sha256').update(ip || 'unknown').digest('hex');
    return {
      email: `portal:login:email:${emailHash}`,
      ip: `portal:login:ip:${ipHash}`,
    };
  }
}
