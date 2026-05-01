import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  CircuitBreakerState,
  CircuitState,
} from './interfaces/circuit-breaker-state.interface';

/**
 * CAS Lua 脚本：原子性 Compare-And-Set 操作
 * KEYS[1] = Redis key
 * ARGV[1] = expectedState（期望的当前 state 值）
 * ARGV[2] = newValue（新的完整 JSON 字符串）
 * ARGV[3] = ttlMs（过期时间，毫秒）
 *
 * 逻辑：
 * 1. GET 当前值
 * 2. 如果 key 不存在，且 expectedState 为 CLOSED（默认状态），则写入
 * 3. 使用 string.match 提取 JSON 中的 "state":"xxx" 字段值
 * 4. 比较 state 是否等于 expectedState
 * 5. 匹配则 SET + PEXPIRE，返回 1
 * 6. 不匹配返回 0
 */
const CAS_LUA_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local expectedState = ARGV[1]
local newValue = ARGV[2]
local ttlMs = tonumber(ARGV[3])

if current == false then
  if expectedState == 'CLOSED' then
    redis.call('SET', KEYS[1], newValue)
    redis.call('PEXPIRE', KEYS[1], ttlMs)
    return 1
  else
    return 0
  end
end

local stateValue = string.match(current, '"state":"([^"]+)"')
if stateValue == expectedState then
  redis.call('SET', KEYS[1], newValue)
  redis.call('PEXPIRE', KEYS[1], ttlMs)
  return 1
else
  return 0
end
`;

/**
 * 本地缓存条目
 */
interface CacheEntry {
  state: CircuitBreakerState;
  /** 缓存写入时间戳（毫秒） */
  cachedAt: number;
}

/**
 * 熔断器状态 Redis 存储层
 * 负责熔断器状态的序列化/反序列化、Redis 读写和本地内存缓存
 */
@Injectable()
export class CircuitBreakerStore {
  private readonly logger = new Logger(CircuitBreakerStore.name);

  /** 本地内存缓存，减少 Redis 读取频率 */
  private readonly cache = new Map<string, CacheEntry>();

  /** 本地缓存 TTL（毫秒） */
  private readonly cacheTtlMs = 1000;

  /** Redis key 前缀 */
  private readonly keyPrefix = 'circuit:provider:';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * 将 CircuitBreakerState 序列化为 JSON 字符串
   * 字段名使用 snake_case 格式存储
   */
  serialize(state: CircuitBreakerState): string {
    const json: Record<string, unknown> = {
      state: state.state,
      opened_at: state.openedAt,
      last_transition_at: state.lastTransitionAt,
      consecutive_failures: state.consecutiveFailures,
      probe_successes: state.probeSuccesses,
      manual_override: state.manualOverride
        ? {
            state: state.manualOverride.state,
            operator: state.manualOverride.operator,
            timestamp: state.manualOverride.timestamp,
          }
        : null,
    };
    return JSON.stringify(json);
  }

  /**
   * 将 JSON 字符串反序列化为 CircuitBreakerState
   * 畸形数据返回 null 并记录 warning 日志
   */
  deserialize(json: string): CircuitBreakerState | null {
    try {
      const parsed = JSON.parse(json);

      // 校验必要字段存在且类型正确
      if (!parsed || typeof parsed !== 'object') {
        this.logger.warn(`反序列化失败：数据不是有效对象，原始数据: ${json}`);
        return null;
      }

      const { state, opened_at, last_transition_at, consecutive_failures, probe_successes, manual_override } = parsed;

      // 校验 state 字段
      if (!Object.values(CircuitState).includes(state)) {
        this.logger.warn(`反序列化失败：无效的 state 值 "${state}"，原始数据: ${json}`);
        return null;
      }

      // 校验 last_transition_at 必须存在
      if (typeof last_transition_at !== 'string' || !last_transition_at) {
        this.logger.warn(`反序列化失败：缺少 last_transition_at 字段，原始数据: ${json}`);
        return null;
      }

      // 校验数值字段
      if (typeof consecutive_failures !== 'number' || consecutive_failures < 0) {
        this.logger.warn(`反序列化失败：无效的 consecutive_failures 值，原始数据: ${json}`);
        return null;
      }

      if (typeof probe_successes !== 'number' || probe_successes < 0) {
        this.logger.warn(`反序列化失败：无效的 probe_successes 值，原始数据: ${json}`);
        return null;
      }

      // 校验 manual_override 结构（如果非 null）
      let parsedManualOverride: CircuitBreakerState['manualOverride'] = null;
      if (manual_override !== null && manual_override !== undefined) {
        if (
          typeof manual_override !== 'object' ||
          !Object.values(CircuitState).includes(manual_override.state) ||
          typeof manual_override.operator !== 'string' ||
          typeof manual_override.timestamp !== 'string'
        ) {
          this.logger.warn(`反序列化失败：无效的 manual_override 结构，原始数据: ${json}`);
          return null;
        }
        parsedManualOverride = {
          state: manual_override.state,
          operator: manual_override.operator,
          timestamp: manual_override.timestamp,
        };
      }

      return {
        state,
        openedAt: opened_at ?? null,
        lastTransitionAt: last_transition_at,
        consecutiveFailures: consecutive_failures,
        probeSuccesses: probe_successes,
        manualOverride: parsedManualOverride,
      };
    } catch (err) {
      this.logger.warn(`反序列化失败：JSON 解析错误，原始数据: ${json}，错误: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * 从 Redis 读取 Provider 的熔断器状态
   * 带 1 秒本地内存缓存，Redis 不可用时返回 null（失败开放）
   */
  async getState(provider: string): Promise<CircuitBreakerState | null> {
    const cacheKey = provider;

    // 检查本地缓存是否有效
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.state;
    }

    const redisKey = `${this.keyPrefix}${provider}`;

    try {
      const raw = await this.redis.get(redisKey);

      if (!raw) {
        // Redis 中无数据，清除本地缓存
        this.cache.delete(cacheKey);
        return null;
      }

      const state = this.deserialize(raw);

      if (!state) {
        // 畸形数据，返回 null（调用方按 CLOSED 处理）
        this.cache.delete(cacheKey);
        return null;
      }

      // 更新本地缓存
      this.cache.set(cacheKey, { state, cachedAt: Date.now() });
      return state;
    } catch (err) {
      this.logger.warn(
        `Redis 不可用，Provider ${provider} 熔断状态读取失败（失败开放）: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 将熔断器状态写入 Redis 并设置 TTL
   * Redis 不可用时静默失败，记录 warning 日志
   */
  async setState(
    provider: string,
    state: CircuitBreakerState,
    ttlMs: number,
  ): Promise<void> {
    const redisKey = `${this.keyPrefix}${provider}`;
    const serialized = this.serialize(state);

    try {
      await this.redis.set(redisKey, serialized, 'PX', ttlMs);

      // 写入成功后更新本地缓存
      this.cache.set(provider, { state, cachedAt: Date.now() });
    } catch (err) {
      this.logger.warn(
        `Redis 不可用，Provider ${provider} 熔断状态写入失败: ${(err as Error).message}`,
      );
    }
  }

  /**
   * 原子性 Compare-And-Set 操作
   * 使用 Lua 脚本确保：仅当 Redis 中当前 state 等于 expectedState 时才写入 newState
   * CAS 失败时返回 false，不重试
   * Redis 不可用时返回 false
   */
  async compareAndSetState(
    provider: string,
    expectedState: CircuitState,
    newState: CircuitBreakerState,
    ttlMs: number,
  ): Promise<boolean> {
    const redisKey = `${this.keyPrefix}${provider}`;
    const serialized = this.serialize(newState);

    try {
      const result = await this.redis.eval(
        CAS_LUA_SCRIPT,
        1,
        redisKey,
        expectedState,
        serialized,
        ttlMs.toString(),
      );

      if (result === 1) {
        // CAS 成功，更新本地缓存
        this.cache.set(provider, { state: newState, cachedAt: Date.now() });
        return true;
      }

      // CAS 失败（状态不匹配），使本地缓存失效以便下次读取最新值
      this.invalidateCache(provider);
      return false;
    } catch (err) {
      this.logger.warn(
        `Redis 不可用，Provider ${provider} CAS 操作失败: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * 使本地缓存失效
   */
  invalidateCache(provider: string): void {
    this.cache.delete(provider);
  }
}
