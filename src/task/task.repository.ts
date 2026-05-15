import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import { TaskStatus } from '../common/constants/task-status';

@Injectable()
export class TaskRepository {
  constructor(@InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>) {}

  async create(data: Partial<Task>): Promise<TaskDocument> {
    return this.taskModel.create(data);
  }

  async findByTaskId(taskId: string): Promise<TaskDocument | null> {
    return this.taskModel.findOne({ taskId });
  }

  async findByClientAndTaskId(
    apiKey: string,
    taskId: string,
  ): Promise<TaskDocument | null> {
    return this.taskModel.findOne({ taskId, apiKey });
  }

  async listByClient(
    apiKey: string,
    filter: FilterQuery<Task>,
    page: number,
    pageSize: number,
  ): Promise<{ items: TaskDocument[]; total: number }> {
    const query: FilterQuery<Task> = { apiKey, ...filter };
    const [items, total] = await Promise.all([
      this.taskModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.taskModel.countDocuments(query),
    ]);
    return { items, total };
  }

  async updateStatus(
    taskId: string,
    fromStatus: TaskStatus | TaskStatus[],
    toStatus: TaskStatus,
    updates: Partial<Task> = {},
  ): Promise<TaskDocument | null> {
    const statusFilter = Array.isArray(fromStatus)
      ? { $in: fromStatus }
      : fromStatus;

    return this.taskModel.findOneAndUpdate(
      { taskId, status: statusFilter },
      {
        $set: { status: toStatus, ...updates },
        $inc: { version: 1 },
      },
      { new: true },
    );
  }

  async findPollableTasks(
    batchSize: number,
    now: Date,
  ): Promise<TaskDocument[]> {
    return this.taskModel
      .find({
        status: { $in: [TaskStatus.SUBMITTED, TaskStatus.PROCESSING] },
        'polling.nextPollAt': { $lte: now },
      })
      .sort({ 'polling.nextPollAt': 1 })
      .limit(batchSize)
      .exec();
  }

  async incrementPollCount(
    taskId: string,
    nextPollAt: Date,
    pollInterval: number,
  ): Promise<void> {
    await this.taskModel.updateOne(
      { taskId },
      {
        $inc: { 'polling.pollCount': 1 },
        $set: {
          'polling.nextPollAt': nextPollAt,
          'polling.lastPolledAt': new Date(),
          'polling.pollInterval': pollInterval,
        },
      },
    );
  }

  /** 轮询侧限流时推迟下次查询，不增加 pollCount（避免误判超时） */
  async deferNextPoll(taskId: string, delayMs: number): Promise<void> {
    await this.taskModel.updateOne(
      { taskId },
      {
        $set: {
          'polling.nextPollAt': new Date(Date.now() + delayMs),
          'polling.lastPolledAt': new Date(),
        },
      },
    );
  }

  /** 更新任务优先级 */
  async updatePriority(taskId: string, priority: number): Promise<void> {
    await this.taskModel.updateOne(
      { taskId },
      { $set: { priority } },
    );
  }
}
