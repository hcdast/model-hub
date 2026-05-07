import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job } from 'bull';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import { TERMINAL_STATUSES, TaskStatus } from '../common/constants/task-status';
import { fingerprintTaskResourceUrls } from '../task/task-payload-urls.util';
import { RemoteMetadataExtractorService } from '../metadata/remote-metadata-extractor.service';
import { TaskCallbackEnqueueService } from '../callback/task-callback-enqueue.service';
import { LinkConversionService } from '../link-conversion/link-conversion.service';

const MAX_URLS_PER_SIDE = 5;

export interface ResourceMetadataJobData {
  taskId: string;
  force?: boolean;
}

function toPlainMetadata(obj: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj ?? {})) as Record<string, unknown>;
}

@Processor('resource-metadata')
export class ResourceMetadataProcessor {
  private readonly logger = new Logger(ResourceMetadataProcessor.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    private readonly metadataExtractor: RemoteMetadataExtractorService,
    private readonly taskCallbackEnqueue: TaskCallbackEnqueueService,
    private readonly linkConversionService: LinkConversionService,
  ) {}

  @Process('extract')
  async handleExtract(job: Job<ResourceMetadataJobData>): Promise<void> {
    const { taskId } = job.data;
    let task = await this.taskModel.findOne({ taskId }).lean();
    if (!task) {
      this.logger.warn(`resource-metadata: task 不存在 ${taskId}`);
      return;
    }

    if (!TERMINAL_STATUSES.has(task.status as TaskStatus)) {
      return;
    }

    // 成功任务：先将结果中的三方 URL 转存到自有存储，再拉元数据、最后业务回调（顺序由本 processor 保证）
    // result 可能是对象、字符串 URL 或 URL 数组（如 WaveSpeed data.output / data.outputs）
    if (task.status === TaskStatus.SUCCESS && task.resultPayload != null) {
      try {
        const { payload, changed } = await this.linkConversionService.processResultPayload(
          task.resultPayload,
          taskId,
        );
        if (changed && payload !== undefined) {
          await this.taskModel.updateOne({ taskId }, { $set: { resultPayload: payload as Task['resultPayload'] } });
          const refetched = await this.taskModel.findOne({ taskId }).lean();
          if (refetched) task = refetched;
        }
      } catch (err) {
        this.logger.warn(
          `结果转存失败，使用原 resultPayload 继续 taskId=${taskId}: `
          + (err instanceof Error ? err.message : String(err)),
        );
      }
    }

    const fp = fingerprintTaskResourceUrls(task.requestPayload, task.resultPayload);
    if (
      !job.data.force &&
      task.resourceMetadataStatus === 'ready' &&
      task.resourceMetadataFingerprint === fp
    ) {
      await this.taskCallbackEnqueue.enqueueForTerminalTask(taskId);
      return;
    }

    const inputUrls = this.metadataExtractor
      .extractUrls(task.requestPayload)
      .slice(0, MAX_URLS_PER_SIDE);
    const outputUrls = this.metadataExtractor
      .extractUrls(task.resultPayload)
      .slice(0, MAX_URLS_PER_SIDE);

    if (inputUrls.length === 0 && outputUrls.length === 0) {
      await this.taskModel.updateOne(
        { taskId },
        {
          $set: {
            resourceMetadata: { input: {}, output: {} },
            resourceMetadataStatus: 'skipped',
            resourceMetadataAt: new Date(),
            resourceMetadataFingerprint: fp,
          },
          $unset: { resourceMetadataError: '' },
        },
      );
      await this.taskCallbackEnqueue.enqueueForTerminalTask(taskId);
      return;
    }

    try {
      const inputMetadata: Record<string, unknown> = {};
      for (const { url } of inputUrls) {
        try {
          const metadata = await this.metadataExtractor.extractFromUrl(url);
          inputMetadata[url] = toPlainMetadata(metadata);
        } catch {
          inputMetadata[url] = {};
        }
      }

      const outputMetadata: Record<string, unknown> = {};
      for (const { url } of outputUrls) {
        try {
          const metadata = await this.metadataExtractor.extractFromUrl(url);
          outputMetadata[url] = toPlainMetadata(metadata);
        } catch {
          outputMetadata[url] = {};
        }
      }

      await this.taskModel.updateOne(
        { taskId },
        {
          $set: {
            resourceMetadata: {
              input: inputMetadata,
              output: outputMetadata,
            },
            resourceMetadataStatus: 'ready',
            resourceMetadataAt: new Date(),
            resourceMetadataFingerprint: fp,
          },
          $unset: { resourceMetadataError: '' },
        },
      );
      await this.taskCallbackEnqueue.enqueueForTerminalTask(taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`resource-metadata 提取失败 taskId=${taskId}: ${message}`);
      await this.taskModel.updateOne(
        { taskId },
        {
          $set: {
            resourceMetadataStatus: 'failed',
            resourceMetadataError: message,
            resourceMetadataAt: new Date(),
            resourceMetadataFingerprint: fp,
          },
        },
      );
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await this.taskCallbackEnqueue.enqueueForTerminalTask(taskId);
      }
      throw err;
    }
  }
}
