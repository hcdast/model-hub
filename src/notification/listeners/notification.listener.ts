import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SystemEvent } from '../events/system-event.types';
import { NotificationService } from '../services/notification.service';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(private readonly notificationService: NotificationService) {}

  @OnEvent('system.*')
  async handleSystemEvent(event: SystemEvent): Promise<void> {
    try {
      await this.notificationService.processEvent(event);
    } catch (error) {
      this.logger.error(
        `Error handling system event ${event?.type}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
