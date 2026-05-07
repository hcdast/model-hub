import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bull';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import { CallbackStatus, TaskStatus } from '../common/constants/task-status';

/**
 * 在任务终态且 Model Hub 侧后置处理（如资源元数据）完成后入队业务回调，避免回调早于内部逻辑执行。
 */
@Injectable()
export class TaskCallbackEnqueueService {
  private readonly logger = new Logger(TaskCallbackEnqueueService.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectQueue('callback') private readonly callbackQueue: Queue,
  ) {}

  /**
   * 对 SUCCESS / CANCELLED 且配置了 callbackUrl 的任务入队 deliver；已成功投递则跳过。
   */
  async enqueueForTerminalTask(taskId: string): Promise<void> {
    const task = await this.taskModel.findOne({ taskId }).lean();
    if (!task?.callback?.url) return;
    if (task.status !== TaskStatus.SUCCESS && task.status !== TaskStatus.CANCELLED) return;
    const cbs = task.callback?.status as CallbackStatus | undefined;
    if (cbs === CallbackStatus.SUCCESS) return;

    try {
      await this.callbackQueue.add(
        'deliver',
        { taskId, callbackUrl: task.callback.url, callbackSecret: task.callback.secret },
        {
          jobId: `mh-auto-callback:${taskId}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        return;
      }
      this.logger.warn(`业务回调入队失败 taskId=${taskId}: ${msg}`);
    }
  }
}
