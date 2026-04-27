import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';

export interface RateLimitResult {
  suppressed: boolean;
  currentCount: number;
}

@Injectable()
export class NotificationRateLimiterService {
  private readonly logger = new Logger(NotificationRateLimiterService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Check whether a notification should be suppressed based on sliding window rate limiting.
   * Uses Redis sorted sets with MULTI/EXEC for atomic sliding window counting.
   *
   * @param ruleId - The notification rule ID
   * @param eventType - The system event type
   * @param windowMs - Sliding window duration in milliseconds
   * @param maxCount - Maximum notifications allowed within the window (0 = unlimited)
   * @returns { suppressed, currentCount }
   */
  async checkAndIncrement(
    ruleId: string,
    eventType: string,
    windowMs: number,
    maxCount: number,
  ): Promise<RateLimitResult> {
    // maxCount of 0 means no limit
    if (maxCount <= 0) {
      return { suppressed: false, currentCount: 0 };
    }

    const key = `notify:rate:${ruleId}:${eventType}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      const pipeline = this.redis.multi();
      // Remove entries outside the sliding window
      pipeline.zremrangebyscore(key, 0, windowStart);
      // Count current entries in the window
      pipeline.zcard(key);

      const results = await pipeline.exec();
      if (!results) {
        this.logger.warn('Redis MULTI/EXEC returned null, allowing notification');
        return { suppressed: false, currentCount: 0 };
      }

      const currentCount = results[1]?.[1] as number;

      if (currentCount >= maxCount) {
        // Suppressed — do not add to the set
        return { suppressed: true, currentCount };
      }

      // Under the limit — add the entry and set TTL
      const addPipeline = this.redis.multi();
      addPipeline.zadd(key, now.toString(), member);
      addPipeline.pexpire(key, windowMs);
      await addPipeline.exec();

      return { suppressed: false, currentCount: currentCount + 1 };
    } catch (error) {
      // Degrade gracefully: allow notification through if Redis is unavailable
      this.logger.warn(
        `Rate limiter Redis error, allowing notification: ${(error as Error).message}`,
      );
      return { suppressed: false, currentCount: 0 };
    }
  }

  /**
   * Check whether a notification is within a cooldown period.
   * Uses a simple Redis key with TTL for cooldown tracking.
   *
   * @param ruleId - The notification rule ID
   * @param eventType - The system event type
   * @param cooldownMs - Cooldown period in milliseconds (0 = no cooldown)
   * @returns true if the notification is within cooldown (should be suppressed)
   */
  async isInCooldown(
    ruleId: string,
    eventType: string,
    cooldownMs: number,
  ): Promise<boolean> {
    if (cooldownMs <= 0) {
      return false;
    }

    const key = `notify:cooldown:${ruleId}:${eventType}`;

    try {
      const result = await this.redis.set(key, '1', 'PX', cooldownMs, 'NX');
      // If SET NX succeeds (returns 'OK'), the key didn't exist → not in cooldown
      // If it returns null, the key already exists → in cooldown
      return result !== 'OK';
    } catch (error) {
      this.logger.warn(
        `Cooldown check Redis error, allowing notification: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
