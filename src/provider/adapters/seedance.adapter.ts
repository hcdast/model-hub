import { Injectable, Logger } from '@nestjs/common';
import { AxiosInstance } from 'axios';
import { TaskStatus } from '../../common/constants/task-status';
import {
  IProviderAdapter, NormalizedTaskRequest, SubmitResult, QueryResult, CancelResult, RateLimitConfig,
} from '../interfaces/provider-adapter.interface';
import { ProviderConfigService } from '../provider-config.service';
import { createRuntimeConfiguredAxios } from '../create-runtime-axios';
import { ErrorLogger } from '../../common/utils/error-logger.util';

@Injectable()
export class SeedanceAdapter implements IProviderAdapter {
  readonly providerName = 'seedance';
  private readonly logger = new Logger(SeedanceAdapter.name);
  private readonly httpClient: AxiosInstance;

  constructor(private readonly providerConfig: ProviderConfigService) {
    this.httpClient = createRuntimeConfiguredAxios(
      this.providerConfig,
      this.providerName,
      { timeout: 30000 },
    );
  }

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    const modelName = this.resolveModelName(request.model);
    const body = this.transformInput(request.input, modelName);

    this.logger.log(`Submit: Seedance model=${modelName}`);
    const response = await this.httpClient.post('/contents/generations/tasks', body);
    const data = response.data;

    return { providerTaskId: data.id || data.task_id, isSync: false, rawResponse: data };
  }

  async queryTask(providerTaskId: string): Promise<QueryResult> {
    const response = await this.httpClient.get(`/contents/generations/tasks/${providerTaskId}`);
    const data = response.data;

    const arkStatus = data.status || data.data?.status;
    const mapped = this.mapQueryStatus(arkStatus);

    let result: any = undefined;
    if (mapped === 'succeeded') {
      const content = data.content || data.data?.content;
      result = content?.video_url || content?.image_url || content;
    }

    return {
      status: mapped,
      progress: data.progress,
      result,
      error: mapped === 'failed' ? { code: 'SEEDANCE_FAILED', message: data.error?.message || 'Task failed' } : undefined,
      rawResponse: data,
    };
  }

  async cancelTask(): Promise<CancelResult> { return { accepted: false, message: 'Not supported' }; }

  mapStatus(providerStatus: string): TaskStatus {
    const map: Record<string, TaskStatus> = {
      succeeded: TaskStatus.SUCCESS, running: TaskStatus.PROCESSING,
      failed: TaskStatus.FAILED, pending: TaskStatus.SUBMITTED,
    };
    return map[providerStatus] || TaskStatus.PROCESSING;
  }

  mapError(providerError: any) {
    const message = providerError?.response?.data?.error?.message || providerError?.message || 'Seedance error';
    const status = providerError?.response?.status;
    return { code: `SEEDANCE_${status || 'ERR'}`, message, retryable: status === 429 || status >= 500 };
  }

  getRateLimitConfig(): RateLimitConfig {
    return this.providerConfig.getSubmitLimitsSync(this.providerName);
  }

  private resolveModelName(model: string): string {
    const parts = model.split('/');
    if (parts[0] === 'seedance') parts.shift();
    const features = ['text-to-video', 'image-to-video', 'video-to-video'];
    if (features.includes(parts[parts.length - 1])) parts.pop();
    return parts.join('/');
  }

  private transformInput(input: Record<string, any>, modelName: string): Record<string, any> {
    const content: any[] = [];

    if (input.prompt) content.push({ type: 'text', text: input.prompt });
    if (input.image) content.push({ type: 'image_url', image_url: { url: input.image } });
    if (input.video) content.push({ type: 'video_url', video_url: { url: input.video } });
    const body: Record<string, any> = {
      model: modelName,
      content,
    };
    if (input.aspect_ratio) body.ratio = input.aspect_ratio;
    if (input.duration) body.duration = input.duration;
    if (input.generate_audio !== undefined) body.generate_audio = input.generate_audio;
    if (input.seed !== undefined) body.seed = input.seed;
    return body;
  }

  private mapQueryStatus(status: string): QueryResult['status'] {
    const map: Record<string, QueryResult['status']> = {
      succeeded: 'succeeded', running: 'processing', failed: 'failed', pending: 'pending',
    };
    return map[status] || 'unknown';
  }
}