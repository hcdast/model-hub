import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StatsService } from './stats.service';
import { RedisLockService } from '../redis/redis-lock.service';

@Injectable()
export class StatsAggregationScheduler {
  private readonly logger = new Logger(StatsAggregationScheduler.name);

  constructor(
    private readonly statsService: StatsService,
    private readonly lockService: RedisLockService,
  ) {}

  @Cron('0 1 * * *')
  async aggregateDailyStats(): Promise<void> {
    const lockToken = await this.lockService.acquire(
      'stats:daily-aggregation',
      60000,
    );
    if (!lockToken) return;

    try {
      const yesterday = this.getYesterdayDateString();
      await this.statsService.aggregateDaily(yesterday);
      this.logger.log(`Daily stats aggregation completed for ${yesterday}`);
    } catch (err: any) {
      this.logger.error(`Daily aggregation failed: ${err.message}`);
    } finally {
      await this.lockService.release('stats:daily-aggregation', lockToken);
    }
  }

  private getYesterdayDateString(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
}
