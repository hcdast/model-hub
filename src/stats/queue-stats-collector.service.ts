import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  QueueSnapshot,
  QueueSnapshotDocument,
} from '../database/schemas/queue-snapshot.schema';
import { QueueRegistryService } from '../queue/queue-registry.service';
import { RedisLockService } from '../redis/redis-lock.service';
import { buildQueueEvent } from '../notification/events/event-emitter.helper';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';

@Injectable()
export class QueueStatsCollectorService {
  private readonly logger = new Logger(QueueStatsCollectorService.name);

  constructor(
    @InjectModel(QueueSnapshot.name)
    private readonly snapshotModel: Model<QueueSnapshotDocument>,
    private readonly queueRegistry: QueueRegistryService,
    private readonly lockService: RedisLockService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() @Inject(APP_CONFIG) private readonly config?: AppConfig,
  ) {}

  @Cron('*/30 * * * * *')
  async collectSnapshots(): Promise<void> {
    const lockToken = await this.lockService.acquire(
      'queue-stats-lock',
      25000,
    );
    if (!lockToken) return;

    try {
      const queues = this.queueRegistry.getAllQueues();
      if (queues.length === 0) return;

      const now = new Date();

      for (const entry of queues) {
        try {
          const counts = await entry.queue.getJobCounts();

          const prevSnapshot = await this.snapshotModel
            .findOne({ queueName: entry.name })
            .sort({ timestamp: -1 })
            .lean();

          const throughputPerMin = this.calcThroughput(prevSnapshot, counts);

          await this.snapshotModel.create({
            timestamp: now,
            queueName: entry.name,
            featureType: entry.featureType,
            provider: entry.provider,
            waiting: counts.waiting,
            active: counts.active,
            completed: counts.completed,
            failed: counts.failed,
            delayed: counts.delayed,
            paused: (counts as any).paused ?? 0,
            depth: counts.waiting + counts.delayed,
            throughputPerMin,
          });

          // Emit queue backlog event if depth exceeds threshold
          const depth = counts.waiting + counts.delayed;
          const backlogThreshold = (this.config as any)?.notification?.queueBacklogThreshold ?? 100;
          if (depth >= backlogThreshold && this.eventEmitter) {
            this.eventEmitter.emit(
              'system.queue_backlog_high',
              buildQueueEvent(entry.name, depth, backlogThreshold),
            );
          }
        } catch (err: any) {
          this.logger.warn(
            `Failed to collect snapshot for queue ${entry.name}: ${err.message}`,
          );
        }
      }
    } finally {
      await this.lockService.release('queue-stats-lock', lockToken);
    }
  }

  /**
   * 与 `QueueRegistry` 中注册的队列一一对应。
   * 优先用最近一次 Mongo 快照；若无快照（新队列或采集未跑过），回退到 Bull 实时计数，避免后台漏项。
   */
  async getLatestStats() {
    const entries = this.queueRegistry.getAllQueues();
    const results: any[] = [];

    for (const entry of entries) {
      const snapshot = await this.snapshotModel
        .findOne({ queueName: entry.name })
        .sort({ timestamp: -1 })
        .lean();
      if (snapshot) {
        results.push(snapshot);
        continue;
      }
      try {
        const counts = await entry.queue.getJobCounts();
        const depth = (counts.waiting || 0) + (counts.delayed || 0);
        results.push({
          timestamp: new Date(),
          queueName: entry.name,
          featureType: entry.featureType,
          provider: entry.provider,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          paused: (counts as any).paused ?? 0,
          depth,
          throughputPerMin: 0,
        });
      } catch (err: any) {
        this.logger.warn(
          `getLatestStats fallback failed for ${entry.name}: ${err.message}`,
        );
        results.push({
          timestamp: new Date(),
          queueName: entry.name,
          featureType: entry.featureType,
          provider: entry.provider,
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
          depth: 0,
          throughputPerMin: 0,
        });
      }
    }

    results.sort((a, b) => {
      const ft = String(a.featureType).localeCompare(String(b.featureType));
      if (ft !== 0) return ft;
      return String(a.queueName).localeCompare(String(b.queueName));
    });
    return results;
  }

  async getHistory(
    queueName: string,
    from: Date,
    to: Date,
    limit = 200,
  ) {
    return this.snapshotModel
      .find({
        queueName,
        timestamp: { $gte: from, $lte: to },
      })
      .sort({ timestamp: 1 })
      .limit(limit)
      .lean();
  }

  private calcThroughput(
    prev: any,
    current: { completed: number },
  ): number {
    if (!prev) return 0;
    const elapsed =
      (Date.now() - new Date(prev.timestamp).getTime()) / 1000;
    if (elapsed <= 0) return 0;
    const completedDiff = current.completed - (prev.completed || 0);
    return Math.round((completedDiff / elapsed) * 60 * 100) / 100;
  }
}
