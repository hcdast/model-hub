import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { Task, TaskSchema } from './schemas/task.schema';
import {
  IdempotencyRecord,
  IdempotencyRecordSchema,
} from './schemas/idempotency-record.schema';
import { CallbackLog, CallbackLogSchema } from './schemas/callback-log.schema';
import {
  TaskDailyStats,
  TaskDailyStatsSchema,
} from './schemas/task-daily-stats.schema';
import {
  QueueSnapshot,
  QueueSnapshotSchema,
} from './schemas/queue-snapshot.schema';
import { AdminUser, AdminUserSchema } from './schemas/admin-user.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { ModelConfig, ModelConfigSchema } from './schemas/model-config.schema';
import { ApiClient, ApiClientSchema } from './schemas/api-client.schema';
import {
  ModelRoutingRule,
  ModelRoutingRuleSchema,
} from './schemas/model-routing-rule.schema';
import {
  ProviderRuntimeConfig,
  ProviderRuntimeConfigSchema,
} from './schemas/provider-runtime-config.schema';
import { Permission, PermissionSchema } from './schemas/permission.schema';
import { Role, RoleSchema } from './schemas/role.schema';
import { MenuConfig, MenuConfigSchema } from './schemas/menu-config.schema';
import {
  BillingRecord,
  BillingRecordSchema,
} from './schemas/billing-record.schema';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import {
  WalletTransaction,
  WalletTransactionSchema,
} from './schemas/wallet-transaction.schema';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        uri: config.mongodb.uri,
        maxPoolSize: config.mongodb.maxPoolSize || 20,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        retryAttempts: 3,
        retryDelay: 3000,
        // proxyHost: '127.0.0.1',
        // proxyPort: 7890,
      }),
    }),
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: IdempotencyRecord.name, schema: IdempotencyRecordSchema },
      { name: CallbackLog.name, schema: CallbackLogSchema },
      { name: TaskDailyStats.name, schema: TaskDailyStatsSchema },
      { name: QueueSnapshot.name, schema: QueueSnapshotSchema },
      { name: AdminUser.name, schema: AdminUserSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: ModelConfig.name, schema: ModelConfigSchema },
      { name: ApiClient.name, schema: ApiClientSchema },
      { name: ModelRoutingRule.name, schema: ModelRoutingRuleSchema },
      { name: ProviderRuntimeConfig.name, schema: ProviderRuntimeConfigSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: Role.name, schema: RoleSchema },
      { name: MenuConfig.name, schema: MenuConfigSchema },
      { name: BillingRecord.name, schema: BillingRecordSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
