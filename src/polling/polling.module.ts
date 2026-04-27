import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { PollingScheduler } from './polling.scheduler';
import { PollingService } from './polling.service';
import { ProviderModule } from '../provider/provider.module';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { TaskRepository } from '../task/task.repository';
import { TaskTimelineService } from '../task/task-timeline.service';
import { TaskTimingService } from '../task/task-timing.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    ProviderModule,
    RedisModule,
    BullModule.registerQueue({ name: 'callback' }),
  ],
  providers: [
    PollingScheduler,
    PollingService,
    TaskRepository,
    TaskTimelineService,
    TaskTimingService,
  ],
})
export class PollingModule {}
