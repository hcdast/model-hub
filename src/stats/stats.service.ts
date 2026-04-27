import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import {
  TaskDailyStats,
  TaskDailyStatsDocument,
} from '../database/schemas/task-daily-stats.schema';

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(TaskDailyStats.name)
    private readonly dailyModel: Model<TaskDailyStatsDocument>,
  ) {}

  async aggregateDaily(date: string): Promise<void> {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const pipeline = [
      { $match: { createdAt: { $gte: startOfDay, $lte: endOfDay } } },
      {
        $group: {
          _id: {
            featureType: '$featureType',
            provider: '$provider',
            model: '$model',
          },
          totalCount: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] },
          },
          timeoutCount: {
            $sum: { $cond: [{ $eq: ['$status', 'TIMEOUT'] }, 1, 0] },
          },
          cancelledCount: {
            $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] },
          },
          avgQueueWaitMs: { $avg: '$timing.queueWaitMs' },
          avgProviderProcessMs: { $avg: '$timing.providerProcessMs' },
          avgTotalE2eMs: { $avg: '$timing.totalE2eMs' },
          allE2eMs: { $push: '$timing.totalE2eMs' },
          callbackSuccessCount: {
            $sum: {
              $cond: [{ $eq: ['$callback.status', 'SUCCESS'] }, 1, 0],
            },
          },
          callbackFailedCount: {
            $sum: {
              $cond: [
                {
                  $in: ['$callback.status', ['FAILED', 'DEAD_LETTER']],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ];

    const results = await this.taskModel.aggregate(pipeline);

    for (const row of results) {
      const e2eValues = (row.allE2eMs as number[])
        .filter((v) => v != null)
        .sort((a, b) => a - b);

      const percentile = (arr: number[], p: number) => {
        if (arr.length === 0) return 0;
        const idx = Math.ceil(arr.length * (p / 100)) - 1;
        return arr[Math.max(0, idx)];
      };

      await this.dailyModel.updateOne(
        {
          date,
          featureType: row._id.featureType,
          provider: row._id.provider,
          model: row._id.model,
        },
        {
          $set: {
            totalCount: row.totalCount,
            successCount: row.successCount,
            failedCount: row.failedCount,
            timeoutCount: row.timeoutCount,
            cancelledCount: row.cancelledCount,
            avgQueueWaitMs: Math.round(row.avgQueueWaitMs || 0),
            avgProviderProcessMs: Math.round(row.avgProviderProcessMs || 0),
            avgTotalE2eMs: Math.round(row.avgTotalE2eMs || 0),
            p50E2eMs: percentile(e2eValues, 50),
            p95E2eMs: percentile(e2eValues, 95),
            p99E2eMs: percentile(e2eValues, 99),
            maxE2eMs: e2eValues.length > 0 ? e2eValues[e2eValues.length - 1] : 0,
            callbackSuccessCount: row.callbackSuccessCount,
            callbackFailedCount: row.callbackFailedCount,
          },
        },
        { upsert: true },
      );
    }

    this.logger.log(`Daily stats aggregated for ${date}: ${results.length} groups`);
  }

  /**
   * 实时聚合今日任务统计（直接查 tasks 表，不依赖预聚合表）
   * 用于 Dashboard 总览页面，确保数据实时准确
   *
   * 修正：
   * 1. failedTasks 需包含 FAILED + TIMEOUT（与 aggregateDaily 对齐）
   * 2. successRate 应基于已完结任务计算，排除 PENDING/SUBMITTED/PROCESSING 等进行中状态
   */
  async getTodayRealtimeStats(): Promise<{
    totalTasks: number;
    successTasks: number;
    failedTasks: number;
    timeoutTasks: number;
    cancelledTasks: number;
    successRate: number;
  }> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

    const pipeline = [
      { $match: { createdAt: { $gte: startOfDay, $lte: endOfDay } } },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          successTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] },
          },
          failedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] },
          },
          timeoutTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'TIMEOUT'] }, 1, 0] },
          },
          cancelledTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] },
          },
        },
      },
    ];

    const results = await this.taskModel.aggregate(pipeline);
    const row = results[0] || {
      totalTasks: 0, successTasks: 0, failedTasks: 0,
      timeoutTasks: 0, cancelledTasks: 0,
    };

    // 已完结任务 = SUCCESS + FAILED + TIMEOUT + CANCELLED
    const completedTasks = row.successTasks + row.failedTasks + row.timeoutTasks + row.cancelledTasks;

    return {
      totalTasks: row.totalTasks,
      successTasks: row.successTasks,
      failedTasks: row.failedTasks,
      timeoutTasks: row.timeoutTasks,
      cancelledTasks: row.cancelledTasks,
      successRate: completedTasks > 0
        ? Math.round((row.successTasks / completedTasks) * 10000) / 100
        : 0,
    };
  }

  async queryDaily(
    filters: {
      dateFrom?: string;
      dateTo?: string;
      featureType?: string;
      provider?: string;
    },
    page = 1,
    pageSize = 50,
  ) {
    const query: any = {};
    if (filters.dateFrom || filters.dateTo) {
      query.date = {};
      if (filters.dateFrom) query.date.$gte = filters.dateFrom;
      if (filters.dateTo) query.date.$lte = filters.dateTo;
    }
    if (filters.featureType) query.featureType = filters.featureType;
    if (filters.provider) query.provider = filters.provider;

    const [items, total] = await Promise.all([
      this.dailyModel
        .find(query)
        .sort({ date: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.dailyModel.countDocuments(query),
    ]);

    return { items, total, page, pageSize };
  }
}
