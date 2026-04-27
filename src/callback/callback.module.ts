import { Module } from '@nestjs/common';
import { CallbackProcessor } from './callback.processor';
import { CallbackSignatureService } from './callback-signature.service';
import { DatabaseModule } from '../database/database.module';
import { TaskTimelineService } from '../task/task-timeline.service';

@Module({
  imports: [DatabaseModule],
  providers: [CallbackProcessor, CallbackSignatureService, TaskTimelineService],
  exports: [CallbackSignatureService],
})
export class CallbackModule {}
