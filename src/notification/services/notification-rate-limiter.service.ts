import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
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
   * Uses one Lua script and Redis server time for atomic sliding window admission.
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
    try {
      const result = await this.redis.eval(`
        local time = redis.call('TIME')
        local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[1]))
        local count = redis.call('ZCARD', KEYS[1])
        if count >= tonumber(ARGV[2]) then return {1, count} end
        redis.call('ZADD', KEYS[1], now, ARGV[3])
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
        return {0, count + 1}
      `, 1, key, windowMs, maxCount, randomUUID()) as [number, number];
      return { suppressed: result[0] === 1, currentCount: result[1] };
    } catch {
      // An unavailable limiter must not admit an unbounded burst.
      this.logger.error('Notification rate limiter unavailable; dispatch was not admitted');
      throw new Error('通知限流状态不可用，未放行投递');
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
