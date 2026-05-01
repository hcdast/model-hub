import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ApiClientService } from './api-client.service';
import { UsageTrackerService } from './usage-tracker.service';

@Module({
  imports: [DatabaseModule],
  providers: [ApiClientService, UsageTrackerService],
  exports: [ApiClientService, UsageTrackerService],
})
export class ApiClientModule {}
