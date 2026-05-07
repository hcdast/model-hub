import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bull';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import { TERMINAL_STATUSES, TaskStatus } from '../common/constants/task-status';
import { fingerprintTaskResourceUrls } from '../task/task-payload-urls.util';
import { TaskCallbackEnqueueService } from '../callback/task-callback-enqueue.service';

export interface ScheduleResourceMetadataOptions {
  /** 为 true 时总是入队（管理端强制刷新），使用独立 jobId */
  force?: boolean;
}

@Injectable()
export class TaskResourceMetadataEnqueueService {
  private readonly logger = new Logger(TaskResourceMetadataEnqueueService.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectQueue('resource-metadata') private readonly resourceMetadataQueue: Queue,
    private readonly taskCallbackEnqueue: TaskCallbackEnqueueService,
  ) {}

  /**
   * 任务进入终态后调用：指纹未变且已有缓存则跳过。
   */
  async scheduleForTask(
    taskId: string,
    options?: ScheduleResourceMetadataOptions,
  ): Promise<void> {
    const task = await this.taskModel.findOne({ taskId }).lean();
    if (!task) return;

    if (!TERMINAL_STATUSES.has(task.status as TaskStatus)) {
      return;
    }

    const fp = fingerprintTaskResourceUrls(task.requestPayload, task.resultPayload);
    if (
      !options?.force &&
      task.resourceMetadataStatus === 'ready' &&
      task.resourceMetadataFingerprint === fp
    ) {
      return;
    }

    if (
      !options?.force &&
      task.resourceMetadataStatus === 'pending'
    ) {
      return;
    }

    await this.taskModel.updateOne(
      { taskId },
      {
        $set: { resourceMetadataStatus: 'pending' },
        $unset: { resourceMetadataError: '' },
      },
    );

    const jobId = options?.force
      ? `resource-metadata:${taskId}:f:${Date.now()}`
      : `resource-metadata:${taskId}`;

    try {
      await this.resourceMetadataQueue.add(
        'extract',
        { taskId, force: !!options?.force },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 8000 },
          timeout: 120_000,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`resource-metadata 入队失败 taskId=${taskId}: ${msg}`);
      await this.taskModel.updateOne(
        { taskId },
        {
          $set: {
            resourceMetadataStatus: 'failed',
            resourceMetadataError: `enqueue: ${msg}`,
          },
        },
      );
      await this.taskCallbackEnqueue.enqueueForTerminalTask(taskId);
    }
  }
}
