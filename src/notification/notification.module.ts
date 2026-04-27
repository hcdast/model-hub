import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RbacModule } from '../admin/rbac.module';

// Schemas
import {
  NotificationRule,
  NotificationRuleSchema,
} from '../database/schemas/notification-rule.schema';
import {
  NotificationRecord,
  NotificationRecordSchema,
} from '../database/schemas/notification-record.schema';
import {
  InAppNotification,
  InAppNotificationSchema,
} from '../database/schemas/in-app-notification.schema';

// Services
import { NotificationService } from './services/notification.service';
import { RuleMatcherService } from './services/rule-matcher.service';
import { NotificationRateLimiterService } from './services/notification-rate-limiter.service';
import { InAppNotificationService } from './services/in-app-notification.service';

// Channels
import { WeComChannel } from './channels/wecom.channel';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/in-app.channel';

// Processor
import { NotificationProcessor } from './processors/notification.processor';

// Listener
import { NotificationListener } from './listeners/notification.listener';

// Controllers
import { NotificationRuleController } from './controllers/notification-rule.controller';
import { NotificationRecordController } from './controllers/notification-record.controller';
import { InAppNotificationController } from './controllers/in-app-notification.controller';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    RbacModule,
    MongooseModule.forFeature([
      { name: NotificationRule.name, schema: NotificationRuleSchema },
      { name: NotificationRecord.name, schema: NotificationRecordSchema },
      { name: InAppNotification.name, schema: InAppNotificationSchema },
    ]),
    BullModule.registerQueue({
      name: 'notification',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  controllers: [
    NotificationRuleController,
    NotificationRecordController,
    InAppNotificationController,
  ],
  providers: [
    NotificationService,
    RuleMatcherService,
    NotificationRateLimiterService,
    InAppNotificationService,
    WeComChannel,
    EmailChannel,
    InAppChannel,
    NotificationProcessor,
    NotificationListener,
  ],
  exports: [
    NotificationService,
    InAppNotificationService,
  ],
})
export class NotificationModule {}
