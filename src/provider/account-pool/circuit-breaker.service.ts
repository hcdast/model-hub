import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants';

export interface CircuitBreakerConfig {
  /** Number of failures within the time window to trip the breaker (default 5) */
  failure_threshold: number;
  /** Sliding window size in seconds (default 60) */
  time_window_seconds: number;
  /** Weight ratio applied when recovering from open state (default 0.5) */
  recovery_initial_weight_ratio: number;
  /** How long the breaker stays open before transitioning to half-open, in seconds (default 30) */
  recovery_probe_interval_seconds: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failure_threshold: 5,
  time_window_seconds: 60,
  recovery_initial_weight_ratio: 0.5,
  recovery_probe_interval_seconds: 30,
};

export type CircuitState = 'closed' | 'open' | 'half-open';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private config: CircuitBreakerConfig;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.config = { ...DEFAULT_CONFIG };
  }

  /** Allow runtime config override (e.g. from provider-level settings) */
  configure(partial: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  // ─── Key helpers ───────────────────────────────────────────────

  private failuresKey(accountId: string): string {
    return `cb:${accountId}:failures`;
  }

  private stateKey(accountId: string): string {
    return `cb:${accountId}:state`;
  }

  // ─── Public API ────────────────────────────────────────────────

  async recordSuccess(accountId: string): Promise<void> {
    const state = await this.getState(accountId);

    if (state === 'half-open') {
      // Successful probe → close the breaker
      await this.redis.del(this.stateKey(accountId));
      await this.redis.del(this.failuresKey(accountId));
      this.logger.log(`Circuit closed for account ${accountId} after successful probe`);
    } else if (state === 'closed') {
      // Optionally trim old failures; a success doesn't reset the window,
      // but we keep the sliding window clean.
      const now = Date.now();
      const windowStart = now - this.config.time_window_seconds * 1000;
      await this.redis.zremrangebyscore(this.failuresKey(accountId), 0, windowStart);
    }
  }

  async recordFailure(accountId: string): Promise<void> {
    const state = await this.getState(accountId);

    if (state === 'open') {
      // Already open, nothing to do
      return;
    }

    if (state === 'half-open') {
      // Failure during probe → back to open
      await this.transitionToOpen(accountId);
      return;
    }

    // state === 'closed': record failure in sliding window
    const now = Date.now();
    const windowStart = now - this.config.time_window_seconds * 1000;
    const key = this.failuresKey(accountId);

    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now.toString(), `${now}-${Math.random()}`);
    pipeline.zcard(key);
    pipeline.pexpire(key, this.config.time_window_seconds * 1000);
    const results = await pipeline.exec();

    const failureCount = (results?.[2]?.[1] as number) ?? 0;

    if (failureCount >= this.config.failure_threshold) {
      await this.transitionToOpen(accountId);
    }
  }

  async isOpen(accountId: string): Promise<boolean> {
    const state = await this.getState(accountId);
    return state === 'open';
  }

  async getState(accountId: string): Promise<CircuitState> {
    const raw = await this.redis.get(this.stateKey(accountId));
    if (raw === 'open' || raw === 'half-open') {
      return raw;
    }
    return 'closed';
  }

  /**
   * Availability score: 0 = completely unavailable, 1 = fully healthy.
   *
   * - open → 0
   * - half-open → recovery_initial_weight_ratio
   * - closed → 1 - (failures_in_window / failure_threshold), clamped to [0, 1]
   */
  async getAvailabilityScore(accountId: string): Promise<number> {
    const state = await this.getState(accountId);

    if (state === 'open') return 0;
    if (state === 'half-open') return this.config.recovery_initial_weight_ratio;

    // closed: compute from sliding window
    const now = Date.now();
    const windowStart = now - this.config.time_window_seconds * 1000;
    await this.redis.zremrangebyscore(this.failuresKey(accountId), 0, windowStart);
    const count = await this.redis.zcard(this.failuresKey(accountId));
    const ratio = count / this.config.failure_threshold;
    return Math.max(0, 1 - ratio);
  }

  /**
   * Transition an account from half-open back to closed with reduced weight.
   * Returns the effective weight (original × recovery_initial_weight_ratio).
   */
  getRecoveryWeight(originalWeight: number): number {
    return originalWeight * this.config.recovery_initial_weight_ratio;
  }

  /**
   * Mark an account as recovered (half-open → closed).
   * Called by HealthCheckScheduler after a successful probe.
   */
  async markRecovered(accountId: string): Promise<void> {
    await this.redis.del(this.stateKey(accountId));
    await this.redis.del(this.failuresKey(accountId));
    this.logger.log(`Account ${accountId} recovered, circuit closed`);
  }

  /**
   * Manually reset the circuit breaker for an account.
   */
  async reset(accountId: string): Promise<void> {
    await this.redis.del(this.stateKey(accountId));
    await this.redis.del(this.failuresKey(accountId));
  }

  // ─── Internal ──────────────────────────────────────────────────

  private async transitionToOpen(accountId: string): Promise<void> {
    // Set state to 'open' with TTL = recovery_probe_interval_seconds
    // When the TTL expires, the state key disappears → getState returns 'closed',
    // but we want it to go to 'half-open' first. So we use a Lua script:
    // set to 'open' now, and schedule transition to 'half-open' via TTL.
    await this.redis.set(
      this.stateKey(accountId),
      'open',
      'EX',
      this.config.recovery_probe_interval_seconds,
    );

    // After the TTL expires, the key is gone → getState returns 'closed'.
    // To support half-open, we set a secondary delayed transition.
    // Simpler approach: use a Lua script that sets 'open' then schedules 'half-open'.
    // For simplicity, we'll handle half-open via the HealthCheckScheduler
    // which periodically checks open accounts and transitions them.
    // Here we just mark as open.

    this.logger.warn(
      `Circuit OPEN for account ${accountId} (threshold=${this.config.failure_threshold})`,
    );
  }

  /**
   * Transition an account to half-open state (called by HealthCheckScheduler).
   */
  async transitionToHalfOpen(accountId: string): Promise<void> {
    await this.redis.set(this.stateKey(accountId), 'half-open');
    this.logger.log(`Circuit half-open for account ${accountId}`);
  }
}
