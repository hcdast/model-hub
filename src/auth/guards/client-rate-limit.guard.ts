import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { Request } from 'express';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { ApiClient, ApiClientDocument } from '../../database/schemas/api-client.schema';

/** 系统默认限流配置 */
const DEFAULT_RATE_LIMITS = {
  maxQps: 10,
  maxDailyRequests: 10000,
};

/**
 * Per-Key 限流 Guard
 *
 * 在 ApiKeyGuard 之后执行，检查：
 * 1. QPS 限流 — Redis 滑动窗口计数器 `ratelimit:qps:{clientId}`
 * 2. 每日请求限额 — Redis INCR `ratelimit:daily:{clientId}:{YYYYMMDD}`
 *
 * Redis 不可用时 fail-open（放行 + warning 日志）
 */
@Injectable()
export class ClientRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ClientRateLimitGuard.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectModel(ApiClient.name) private readonly apiClientModel: Model<ApiClientDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const clientId = (request as any).clientId as string;

    if (!clientId) {
      // 没有 clientId 说明 ApiKeyGuard 未执行或未设置，直接放行
      return true;
    }

    try {
      // 获取客户端限流配置
      const rateLimits = await this.getClientRateLimits(clientId);
      const maxQps = rateLimits.maxQps ?? DEFAULT_RATE_LIMITS.maxQps;
      const maxDailyRequests = rateLimits.maxDailyRequests ?? DEFAULT_RATE_LIMITS.maxDailyRequests;

      // 1. QPS 检查 — 滑动窗口
      const qpsAllowed = await this.checkQps(clientId, maxQps);
      if (!qpsAllowed) {
        throw new HttpException(
          { success: false, error: 'QPS limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 2. 每日限额检查
      const dailyAllowed = await this.checkDailyLimit(clientId, maxDailyRequests);
      if (!dailyAllowed) {
        throw new HttpException(
          { success: false, error: 'Daily request limit exceeded', code: 'DAILY_LIMIT_EXCEEDED' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (error) {
      // 如果是我们主动抛出的 HttpException，直接重新抛出
      if (error instanceof HttpException) {
        throw error;
      }
      // Redis 不可用或其他异常时 fail-open
      this.logger.warn(
        `限流检查异常，fail-open 放行: clientId=${clientId}, error=${(error as Error).message}`,
      );
      return true;
    }
  }

  /**
   * 获取客户端的限流配置
   * 优先使用客户端自定义配置，无自定义配置时使用系统默认值
   */
  private async getClientRateLimits(clientId: string): Promise<{
    maxQps?: number;
    maxDailyRequests?: number;
  }> {
    const doc = await this.apiClientModel
      .findOne({ clientId })
      .select('rateLimits')
      .lean()
      .exec();

    if (!doc || !doc.rateLimits) {
      return DEFAULT_RATE_LIMITS;
    }

    return {
      maxQps: doc.rateLimits.maxQps ?? DEFAULT_RATE_LIMITS.maxQps,
      maxDailyRequests: doc.rateLimits.maxDailyRequests ?? DEFAULT_RATE_LIMITS.maxDailyRequests,
    };
  }

  /**
   * QPS 检查 — 滑动窗口计数器
   *
   * 使用 Redis Sorted Set 实现滑动窗口：
   * - key: `ratelimit:qps:{clientId}`
   * - score: 当前时间戳（毫秒）
   * - 窗口大小: 1000ms
   *
   * 步骤：
   * 1. 移除窗口外的旧记录
   * 2. 添加当前请求
   * 3. 统计窗口内请求数
   * 4. 设置 key 过期时间（防止内存泄漏）
   */
  private async checkQps(clientId: string, maxQps: number): Promise<boolean> {
    const now = Date.now();
    const windowMs = 1000; // 1 秒窗口
    const key = `ratelimit:qps:${clientId}`;

    const pipeline = this.redis.pipeline();
    // 移除窗口外的旧记录
    pipeline.zremrangebyscore(key, 0, now - windowMs);
    // 添加当前请求（使用时间戳 + 随机数确保唯一性）
    pipeline.zadd(key, now.toString(), `${now}-${Math.random()}`);
    // 统计窗口内请求数
    pipeline.zcard(key);
    // 设置 key 过期时间为 2 秒（窗口大小的 2 倍，防止内存泄漏）
    pipeline.pexpire(key, windowMs * 2);

    const results = await pipeline.exec();
    if (!results) return true; // pipeline 执行失败时 fail-open

    const count = results[2]?.[1] as number;
    return count <= maxQps;
  }

  /**
   * 每日限额检查
   *
   * 使用 Redis INCR 实现每日计数器：
   * - key: `ratelimit:daily:{clientId}:{YYYYMMDD}`
   * - 使用 INCR 原子递增
   * - 使用 EXPIREAT 设置次日零点过期
   */
  private async checkDailyLimit(clientId: string, maxDailyRequests: number): Promise<boolean> {
    const today = this.getTodayStr();
    const key = `ratelimit:daily:${clientId}:${today}`;

    // 使用 INCR 原子递增，返回递增后的值
    const count = await this.redis.incr(key);

    // 如果是当天第一次请求（count === 1），设置过期时间为次日零点
    if (count === 1) {
      const expireAt = this.getNextMidnightTimestamp();
      await this.redis.expireat(key, expireAt);
    }

    return count <= maxDailyRequests;
  }

  /** 获取当天日期字符串 YYYYMMDD */
  private getTodayStr(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /** 获取次日零点的 Unix 时间戳（秒） */
  private getNextMidnightTimestamp(): number {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return Math.floor(tomorrow.getTime() / 1000);
  }
}
