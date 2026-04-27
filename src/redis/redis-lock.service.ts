import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await this.redis.set(
      `lock:${key}`,
      token,
      'PX',
      ttlMs,
      'NX',
    );
    if (result === 'OK') {
      this.logger.debug(`Lock acquired: ${key}`);
      return token;
    }
    return null;
  }

  async release(key: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.redis.eval(script, 1, `lock:${key}`, token);
    const released = result === 1;
    if (released) {
      this.logger.debug(`Lock released: ${key}`);
    }
    return released;
  }
}
