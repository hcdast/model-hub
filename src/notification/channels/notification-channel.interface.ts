import { SystemEvent } from '../events/system-event.types';

// Re-export NotificationChannelType from the schema where it's canonically defined
export { NotificationChannelType } from '../../database/schemas/notification-rule.schema';
import { NotificationChannelType } from '../../database/schemas/notification-rule.schema';

export interface ChannelResult {
  success: boolean;
  error?: string;
  responseData?: any;
}

export interface INotificationChannel {
  readonly channelType: NotificationChannelType;
  send(
    event: SystemEvent,
    config: Record<string, any>,
    recipients: string[],
  ): Promise<ChannelResult>;
}
