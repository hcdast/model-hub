import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 15 * 60;
const EMAIL_ATTEMPT_LIMIT = 10;
const IP_ATTEMPT_LIMIT = 50;
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

@Injectable()
export class PortalLoginThrottleService {
  private readonly logger = new Logger(PortalLoginThrottleService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(ip: string | undefined, email: string): Promise<void> {
    const keys = this.getKeys(ip, email);
    try {
      const [emailAttempts, ipAttempts] = await Promise.all([
        this.increment(keys.email),
        this.increment(keys.ip),
      ]);
      if (emailAttempts > EMAIL_ATTEMPT_LIMIT || ipAttempts > IP_ATTEMPT_LIMIT) {
        throw new HttpException(
          'Too many login attempts. Try again later.',
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

  private async increment(key: string): Promise<number> {
    return Number(await this.redis.eval(INCREMENT_SCRIPT, 1, key, WINDOW_SECONDS));
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
