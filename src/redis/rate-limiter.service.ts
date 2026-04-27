import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Sliding window rate limiter.
   * Returns true if the request is allowed, false if rate limited.
   */
  async acquire(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const windowKey = `ratelimit:${key}`;

    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(windowKey, 0, now - windowMs);
    pipeline.zadd(windowKey, now.toString(), `${now}-${Math.random()}`);
    pipeline.zcard(windowKey);
    pipeline.pexpire(windowKey, windowMs);

    const results = await pipeline.exec();
    if (!results) return true;

    const count = results[2]?.[1] as number;
    const allowed = count <= maxRequests;

    if (!allowed) {
      this.logger.warn(
        `Rate limited: key=${key}, count=${count}/${maxRequests}`,
      );
    }
    return allowed;
  }

  /**
   * Concurrent limiter using sorted set.
   * Returns a token if slot acquired, null if full.
   */
  async acquireConcurrent(
    key: string,
    maxConcurrent: number,
    ttlMs: number,
  ): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const concKey = `concurrent:${key}`;
    const now = Date.now();

    await this.redis.zremrangebyscore(concKey, 0, now - ttlMs);
    const count = await this.redis.zcard(concKey);

    if (count >= maxConcurrent) {
      return null;
    }

    await this.redis.zadd(concKey, now.toString(), token);
    await this.redis.pexpire(concKey, ttlMs);
    return token;
  }

  async releaseConcurrent(key: string, token: string): Promise<void> {
    await this.redis.zrem(`concurrent:${key}`, token);
  }
}
