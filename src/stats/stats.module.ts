import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StatsService } from './stats.service';
import { StatsAggregationScheduler } from './stats-aggregation.scheduler';
import { QueueStatsCollectorService } from './queue-stats-collector.service';
import { DatabaseModule } from '../database/database.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, QueueModule],
  providers: [
    StatsService,
    StatsAggregationScheduler,
    QueueStatsCollectorService,
  ],
  exports: [StatsService, QueueStatsCollectorService],
})
export class StatsModule {}
