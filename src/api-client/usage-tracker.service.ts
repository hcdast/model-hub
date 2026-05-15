import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { roundMoney } from '../common/utils/money.util';

/** 单日用量统计 */
export interface UsageStats {
  apiKey: string;
  date: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalCost: number;
}

/** 客户端用量汇总 */
export interface ClientUsageSummary {
  apiKey: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalCost: number;
}

/**
 * 用量追踪服务
 *
 * 使用 Redis Hash 实时记录每个 API 客户端的调用量和资源消耗。
 * Redis key 格式: `usage:daily:{apiKey}:{YYYYMMDD}`
 * Hash fields: requests, success, failed, totalCost
 */
@Injectable()
export class UsageTrackerService {
  private readonly logger = new Logger(UsageTrackerService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * 记录一次请求（任务创建时调用）
   * 递增 requests 字段，并设置 key 过期时间为 7 天
   */
  async recordRequest(apiKey: string): Promise<void> {
    const key = this.buildKey(apiKey);
    try {
      const pipeline = this.redis.pipeline();
      pipeline.hincrby(key, 'requests', 1);
      // 设置 7 天过期，避免数据无限堆积
      pipeline.expire(key, 7 * 24 * 60 * 60);
      await pipeline.exec();
    } catch (error) {
      // Usage 记录失败不阻塞业务，仅记录 warning
      this.logger.warn(
        `记录请求用量失败: apiKey=${apiKey}, error=${(error as Error).message}`,
      );
    }
  }

  /**
   * 记录任务完成/失败结果
   * 更新 success/failed 计数器，累加 totalCost（如有）
   */
  async recordCompletion(
    apiKey: string,
    success: boolean,
    cost?: number,
  ): Promise<void> {
    const key = this.buildKey(apiKey);
    try {
      const pipeline = this.redis.pipeline();
      if (success) {
        pipeline.hincrby(key, 'success', 1);
      } else {
        pipeline.hincrby(key, 'failed', 1);
      }
      if (cost !== undefined && cost > 0) {
        // totalCost 以分为单位存储整数，乘以 100 避免浮点精度问题
        pipeline.hincrby(key, 'totalCost', Math.round(cost * 100));
      }
      pipeline.expire(key, 7 * 24 * 60 * 60);
      await pipeline.exec();
    } catch (error) {
      this.logger.warn(
        `记录完成用量失败: apiKey=${apiKey}, success=${success}, error=${(error as Error).message}`,
      );
    }
  }

  /**
   * 查询指定客户端在日期范围内的用量统计
   * @param apiKey 客户端 ID
   * @param dateRange 日期范围，格式 { from: 'YYYYMMDD', to: 'YYYYMMDD' }
   */
  async getUsage(
    apiKey: string,
    dateRange: { from: string; to: string },
  ): Promise<UsageStats[]> {
    const dates = this.getDateRange(dateRange.from, dateRange.to);
    const results: UsageStats[] = [];

    for (const date of dates) {
      const key = `usage:daily:${apiKey}:${date}`;
      try {
        const data = await this.redis.hgetall(key);
        results.push({
          apiKey,
          date,
          totalRequests: parseInt(data.requests || '0', 10),
          successRequests: parseInt(data.success || '0', 10),
          failedRequests: parseInt(data.failed || '0', 10),
          // 从分转换回元
          totalCost: roundMoney(parseInt(data.totalCost || '0', 10) / 100),
        });
      } catch (error) {
        this.logger.warn(
          `查询用量失败: apiKey=${apiKey}, date=${date}, error=${(error as Error).message}`,
        );
        results.push({
          apiKey,
          date,
          totalRequests: 0,
          successRequests: 0,
          failedRequests: 0,
          totalCost: 0,
        });
      }
    }

    return results;
  }

  /**
   * 获取所有客户端的当日用量汇总
   */
  async getUsageSummary(): Promise<ClientUsageSummary[]> {
    const today = this.getTodayStr();
    const pattern = `usage:daily:*:${today}`;

    try {
      const keys = await this.scanKeys(pattern);
      const summaries: ClientUsageSummary[] = [];

      for (const key of keys) {
        // key 格式: usage:daily:{apiKey}:{date}
        const parts = key.split(':');
        const apiKey = parts[2];
        const data = await this.redis.hgetall(key);

        summaries.push({
          apiKey,
          totalRequests: parseInt(data.requests || '0', 10),
          successRequests: parseInt(data.success || '0', 10),
          failedRequests: parseInt(data.failed || '0', 10),
          totalCost: roundMoney(parseInt(data.totalCost || '0', 10) / 100),
        });
      }

      return summaries;
    } catch (error) {
      this.logger.warn(
        `获取用量汇总失败: error=${(error as Error).message}`,
      );
      return [];
    }
  }

  /** 构建当日 Redis Hash key */
  private buildKey(apiKey: string): string {
    return `usage:daily:${apiKey}:${this.getTodayStr()}`;
  }

  /** 获取当天日期字符串 YYYYMMDD */
  private getTodayStr(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /** 生成日期范围内的所有日期字符串 */
  private getDateRange(from: string, to: string): string[] {
    const dates: string[] = [];
    const startDate = this.parseDate(from);
    const endDate = this.parseDate(to);

    const current = new Date(startDate);
    while (current <= endDate) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      dates.push(`${year}${month}${day}`);
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  /** 解析 YYYYMMDD 格式日期 */
  private parseDate(dateStr: string): Date {
    const year = parseInt(dateStr.slice(0, 4), 10);
    const month = parseInt(dateStr.slice(4, 6), 10) - 1;
    const day = parseInt(dateStr.slice(6, 8), 10);
    return new Date(year, month, day);
  }

  /** 使用 SCAN 命令安全遍历匹配的 keys */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }
}
