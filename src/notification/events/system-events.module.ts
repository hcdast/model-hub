import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

/** One shared emitter for billing, circuit transitions and notification listeners. */
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: true })],
  exports: [EventEmitterModule],
})
export class SystemEventsModule {}
