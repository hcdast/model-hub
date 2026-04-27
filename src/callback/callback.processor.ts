import { Process, Processor } from '@nestjs/bull';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bull';
import axios from 'axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import { CallbackLog, CallbackLogDocument } from '../database/schemas/callback-log.schema';
import { CallbackSignatureService } from './callback-signature.service';
import { CallbackStatus } from '../common/constants/task-status';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { MetricsService } from '../observability/metrics.service';
import { TaskTimelineService, TimelineEvent } from '../task/task-timeline.service';
import { ErrorLogger } from '../common/utils/error-logger.util';

export interface CallbackJobData { taskId: string; callbackUrl: string; callbackSecret?: string; }

@Processor('callback')
export class CallbackProcessor {
  private readonly logger = new Logger(CallbackProcessor.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(CallbackLog.name) private readonly callbackLogModel: Model<CallbackLogDocument>,
    private readonly signatureService: CallbackSignatureService,
    private readonly metrics: MetricsService,
    private readonly timelineService: TaskTimelineService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Process('deliver')
  async handleCallback(job: Job<CallbackJobData>): Promise<void> {
    const { taskId, callbackUrl, callbackSecret } = job.data;
    const attempt = job.attemptsMade + 1;

    const task = await this.taskModel.findOne({ taskId });
    if (!task) {
      ErrorLogger.logWarning(
        this.logger,
        'Task not found for callback',
        { taskId, callbackUrl, attempt },
      );
      return;
    }

    const payload = { taskId: task.taskId, status: task.status, result: task.resultPayload || null, error: task.error || null, completedAt: (task as any).updatedAt };
    const bodyStr = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = callbackSecret || this.config.callback.defaultSecret;
    const signature = this.signatureService.sign(bodyStr, secret, timestamp);

    const headers = {
      'Content-Type': 'application/json', 'X-ModelHub-Signature': `sha256=${signature}`,
      'X-ModelHub-Timestamp': timestamp.toString(), 'X-ModelHub-TaskId': taskId,
    };

    const requestSummary = {
      method: 'POST' as const,
      callbackUrl,
      attempt,
      headers: {
        'Content-Type': headers['Content-Type'],
        'X-ModelHub-Timestamp': headers['X-ModelHub-Timestamp'],
        'X-ModelHub-TaskId': headers['X-ModelHub-TaskId'],
        'X-ModelHub-Signature': `sha256=****${signature.slice(-8)}`,
      },
      body: {
        taskId: payload.taskId,
        status: payload.status,
        hasResult: payload.result != null,
        hasError: payload.error != null,
      },
    };

    await this.timelineService.addEvent(taskId, TimelineEvent.CALLBACK_SEND, { request: requestSummary });

    this.logger.log(
      `Callback HTTP request: taskId=${taskId} attempt=${attempt} url=${callbackUrl} `
        + `ts=${headers['X-ModelHub-Timestamp']} sigTail=${signature.slice(-8)}`,
    );

    const start = Date.now();
    try {
      const response = await axios.post(callbackUrl, payload, { headers, timeout: this.config.callback.timeoutMs });
      const latencyMs = Date.now() - start;
      const responseBodyStr = typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data ?? '');
      const responsePreview = responseBodyStr.slice(0, 512);

      await this.callbackLogModel.create({ taskId, callbackUrl, attempt, requestHeaders: headers, requestBody: payload, responseCode: response.status, responseBody: responseBodyStr.slice(0, 1024), success: true, latencyMs });
      await this.taskModel.updateOne({ taskId }, { $set: { 'callback.status': CallbackStatus.SUCCESS, 'callback.lastAttemptAt': new Date() } });
      this.metrics.callbackTotal.inc({ status: 'success' });

      await this.timelineService.addEvent(taskId, TimelineEvent.CALLBACK_OK, {
        attempt,
        latencyMs,
        httpStatus: response.status,
        responsePreview,
      });

      this.logger.log(
        `Callback delivered: taskId=${taskId} attempt=${attempt} latency=${latencyMs}ms http=${response.status} `
          + `bodyPreview=${responsePreview.slice(0, 120)}${responsePreview.length > 120 ? '…' : ''}`,
      );
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const errorMsg = err.message || 'Unknown error';
      const httpStatus = err.response?.status as number | undefined;
      const responseData = err.response?.data;
      const errBodyPreview = responseData !== undefined
        ? (typeof responseData === 'string' ? responseData : JSON.stringify(responseData)).slice(0, 512)
        : undefined;

      await this.callbackLogModel.create({ taskId, callbackUrl, attempt, requestHeaders: headers, requestBody: payload, responseCode: httpStatus, success: false, error: errorMsg, latencyMs });
      const isLastAttempt = attempt >= this.config.callback.maxRetries;
      await this.taskModel.updateOne({ taskId }, { $set: { 'callback.status': isLastAttempt ? CallbackStatus.DEAD_LETTER : CallbackStatus.FAILED, 'callback.lastAttemptAt': new Date(), 'callback.lastError': errorMsg, 'callback.retryCount': attempt } });
      this.metrics.callbackTotal.inc({ status: isLastAttempt ? 'dead_letter' : 'failed' });

      const failEvent = isLastAttempt ? TimelineEvent.CALLBACK_DEAD_LETTER : TimelineEvent.CALLBACK_FAIL;
      await this.timelineService.addEvent(taskId, failEvent, {
        attempt,
        latencyMs,
        httpStatus,
        error: errorMsg,
        responsePreview: errBodyPreview,
        willRetry: !isLastAttempt,
        maxRetries: this.config.callback.maxRetries,
      });

      ErrorLogger.logError(
        this.logger,
        err,
        {
          taskId,
          callbackUrl,
          attempt,
          maxRetries: this.config.callback.maxRetries,
          httpStatus,
          latencyMs,
          isLastAttempt,
        },
        `Callback ${isLastAttempt ? 'dead letter' : 'failed'}`,
      );
      throw err;
    }
  }
}
