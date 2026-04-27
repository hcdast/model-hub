import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../database/schemas/task.schema';

export enum TimelineEvent {
  TASK_CREATED = 'TASK_CREATED',
  TASK_ENQUEUED = 'TASK_ENQUEUED',
  TASK_DEQUEUED = 'TASK_DEQUEUED',
  PROVIDER_SUBMIT_START = 'PROVIDER_SUBMIT_START',
  PROVIDER_SUBMIT_OK = 'PROVIDER_SUBMIT_OK',
  PROVIDER_SUBMIT_FAIL = 'PROVIDER_SUBMIT_FAIL',
  POLL_START = 'POLL_START',
  POLL_RESULT = 'POLL_RESULT',
  PROVIDER_COMPLETED = 'PROVIDER_COMPLETED',
  PROVIDER_FAILED = 'PROVIDER_FAILED',
  TASK_SUCCESS = 'TASK_SUCCESS',
  TASK_FAILED = 'TASK_FAILED',
  TASK_TIMEOUT = 'TASK_TIMEOUT',
  TASK_CANCELLED = 'TASK_CANCELLED',
  CALLBACK_SEND = 'CALLBACK_SEND',
  CALLBACK_OK = 'CALLBACK_OK',
  CALLBACK_FAIL = 'CALLBACK_FAIL',
  CALLBACK_DEAD_LETTER = 'CALLBACK_DEAD_LETTER',
  ROUTE_RESOLVED = 'ROUTE_RESOLVED',
  RETRY_ENQUEUED = 'RETRY_ENQUEUED',
  PRIORITY_CHANGED = 'PRIORITY_CHANGED',
}

@Injectable()
export class TaskTimelineService {
  private readonly logger = new Logger(TaskTimelineService.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  async addEvent(
    taskId: string,
    event: TimelineEvent | string,
    detail?: Record<string, any>,
  ): Promise<void> {
    const now = new Date();

    try {
      const task = await this.taskModel
        .findOne({ taskId }, { timeline: { $slice: -1 } })
        .lean() as any;

      const lastTimestamp =
        task?.timeline && task.timeline.length > 0
          ? new Date(task.timeline[task.timeline.length - 1].timestamp).getTime()
          : now.getTime();

      const durationFromPrev = now.getTime() - lastTimestamp;

      await this.taskModel.updateOne(
        { taskId },
        {
          $push: {
            timeline: {
              event,
              timestamp: now,
              detail: detail || {},
              durationFromPrev,
            },
          },
        },
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to add timeline event ${event} for task ${taskId}: ${err.message}`,
      );
    }
  }

  async getTimeline(
    taskId: string,
  ): Promise<Array<{ event: string; timestamp: Date; detail?: any; durationFromPrev?: number }>> {
    const task = await this.taskModel
      .findOne({ taskId }, { timeline: 1 })
      .lean() as any;
    return (task?.timeline as any[]) || [];
  }
}
