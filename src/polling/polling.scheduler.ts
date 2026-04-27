import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PollingService } from './polling.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';

@Injectable()
export class PollingScheduler {
  private readonly logger = new Logger(PollingScheduler.name);

  constructor(
    private readonly pollingService: PollingService,
    private readonly lockService: RedisLockService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Cron('*/30 * * * * *')
  async handlePolling(): Promise<void> {
    const ttl = this.config.polling.lockTtlMs;
    const lockToken = await this.lockService.acquire('polling:scheduler', ttl);
    if (!lockToken) return;

    try {
      const count = await this.pollingService.pollPendingTasks();
      if (count > 0) this.logger.log(`Polled ${count} tasks`);
    } catch (err: any) {
      this.logger.error(`Polling error: ${err.message}`);
    } finally {
      await this.lockService.release('polling:scheduler', lockToken);
    }
  }
}
