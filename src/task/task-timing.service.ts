import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../database/schemas/task.schema';

@Injectable()
export class TaskTimingService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  async recordTiming(
    taskId: string,
    field: string,
    timestamp?: Date,
  ): Promise<void> {
    const ts = timestamp || new Date();
    await this.taskModel.updateOne(
      { taskId },
      { $set: { [`timing.${field}`]: ts } },
    );
  }

  async calculateAndSave(taskId: string): Promise<void> {
    const task = await this.taskModel.findOne({ taskId }).lean() as any;
    if (!task?.timing) return;

    const t = task.timing;
    const updates: Record<string, number | null> = {};

    if (t.dequeuedAt && t.enqueuedAt) {
      updates['timing.queueWaitMs'] =
        new Date(t.dequeuedAt).getTime() - new Date(t.enqueuedAt).getTime();
    }
    if (t.completedAt && t.submittedAt) {
      updates['timing.providerProcessMs'] =
        new Date(t.completedAt).getTime() - new Date(t.submittedAt).getTime();
    }
    if (t.completedAt && t.receivedAt) {
      updates['timing.totalE2eMs'] =
        new Date(t.completedAt).getTime() - new Date(t.receivedAt).getTime();
    }
    if (t.callbackSentAt && t.completedAt) {
      updates['timing.callbackDelayMs'] =
        new Date(t.callbackSentAt).getTime() -
        new Date(t.completedAt).getTime();
    }

    if (Object.keys(updates).length > 0) {
      await this.taskModel.updateOne({ taskId }, { $set: updates });
    }
  }

  async getTiming(taskId: string): Promise<Record<string, any> | null> {
    const task = await this.taskModel.findOne({ taskId }, { timing: 1 }).lean() as any;
    return (task?.timing as Record<string, any>) || null;
  }
}
