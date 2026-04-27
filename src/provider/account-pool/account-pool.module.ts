import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import {
  AccountPoolEntry,
  AccountPoolEntrySchema,
} from '../../database/schemas/account-pool-entry.schema';
import {
  AccountCostDaily,
  AccountCostDailySchema,
} from '../../database/schemas/account-cost-daily.schema';
import { CircuitBreakerService } from './circuit-breaker.service';
import { CostTrackerService } from './cost-tracker.service';
import { AccountPoolService } from './account-pool.service';
import { HealthCheckScheduler } from './health-check.scheduler';
import { WeightedRoundRobinStrategy } from './strategies/weighted-round-robin.strategy';
import { LeastCostStrategy } from './strategies/least-cost.strategy';
import { CompositeScoreStrategy } from './strategies/composite-score.strategy';

// Use a forward reference to avoid circular dependency:
// ProviderModule imports AccountPoolModule, and AccountPoolService
// optionally injects ProviderConfigService from ProviderModule.
import { ProviderConfigService } from '../provider-config.service';
import {
  ProviderRuntimeConfig,
  ProviderRuntimeConfigSchema,
} from '../../database/schemas/provider-runtime-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AccountPoolEntry.name, schema: AccountPoolEntrySchema },
      { name: AccountCostDaily.name, schema: AccountCostDailySchema },
      { name: ProviderRuntimeConfig.name, schema: ProviderRuntimeConfigSchema },
    ]),
    ScheduleModule.forRoot(),
  ],
  providers: [
    CircuitBreakerService,
    CostTrackerService,
    WeightedRoundRobinStrategy,
    LeastCostStrategy,
    CompositeScoreStrategy,
    ProviderConfigService,
    AccountPoolService,
    HealthCheckScheduler,
  ],
  exports: [
    AccountPoolService,
    CostTrackerService,
    CircuitBreakerService,
    ProviderConfigService,
    MongooseModule,
  ],
})
export class AccountPoolModule {}
