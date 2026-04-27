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
export class WanAdapter implements IProviderAdapter {
  readonly providerName = 'alibaba';
  private readonly logger = new Logger(WanAdapter.name);
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
    const headers = this.buildHeaders(true);

    this.logger.log(`Submit: Wan/DashScope model=${modelName}`);
    const response = await this.httpClient.post(
      '/api/v1/services/aigc/image-generation/generation', body, { headers },
    );
    const data = response.data;

    const taskId = data.output?.task_id || data.request_id;
    if (!taskId) {
      const error = new Error('Wan API did not return task_id');
      ErrorLogger.logError(
        this.logger,
        error,
        { model: request.model, provider: this.providerName },
        'Wan API did not return task_id',
      );
      throw error;
    }

    return { providerTaskId: taskId, isSync: false, rawResponse: data };
  }

  async queryTask(providerTaskId: string): Promise<QueryResult> {
    const headers = this.buildHeaders(false);
    const response = await this.httpClient.get(`/api/v1/tasks/${providerTaskId}`, { headers });
    const data = response.data;

    const status = data.output?.task_status || data.status;
    const mapped = this.mapQueryStatus(status);

    let result: any = undefined;
    if (mapped === 'succeeded') {
      result = data.output?.results || data.output;
    }

    return {
      status: mapped,
      progress: data.output?.progress,
      result,
      error: mapped === 'failed' ? {
        code: data.output?.code || 'WAN_FAILED',
        message: data.output?.message || 'Task failed',
      } : undefined,
      rawResponse: data,
    };
  }

  async cancelTask(): Promise<CancelResult> { return { accepted: false, message: 'Not supported' }; }

  mapStatus(providerStatus: string): TaskStatus {
    const map: Record<string, TaskStatus> = {
      SUCCEEDED: TaskStatus.SUCCESS, PENDING: TaskStatus.SUBMITTED,
      RUNNING: TaskStatus.PROCESSING, FAILED: TaskStatus.FAILED,
      CANCELED: TaskStatus.CANCELLED, UNKNOWN: TaskStatus.FAILED,
    };
    return map[providerStatus] || TaskStatus.PROCESSING;
  }

  mapError(providerError: any) {
    const message = providerError?.response?.data?.message || providerError?.message || 'Wan error';
    const status = providerError?.response?.status;
    return { code: `WAN_${status || 'ERR'}`, message, retryable: status === 429 || status >= 500 };
  }

  getRateLimitConfig(): RateLimitConfig {
    return this.providerConfig.getSubmitLimitsSync(this.providerName);
  }

  private resolveModelName(model: string): string {
    const parts = model.split('/');
    if (parts[0] === 'alibaba') parts.shift();
    const features = ['text-to-image', 'image-to-image'];
    if (features.includes(parts[parts.length - 1])) parts.pop();
    return parts.join('-');
  }

  private transformInput(input: Record<string, any>, modelName: string): Record<string, any> {
    const body: Record<string, any> = {
      model: modelName,
      input: { prompt: input.prompt || '' },
      parameters: {},
    };

    if (input.negative_prompt) body.input.negative_prompt = input.negative_prompt;
    if (input.image) body.input.ref_image_url = input.image;
    if (input.resolution) body.parameters.size = input.resolution;
    if (input.seed !== undefined) body.parameters.seed = input.seed;
    if (input.image_quantity) body.parameters.n = input.image_quantity;

    return body;
  }

  private buildHeaders(asyncMode: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-DashScope-DataInspection': '{"input":"disable", "output":"disable"}',
    };
    if (asyncMode) headers['X-DashScope-Async'] = 'enable';
    return headers;
  }

  private mapQueryStatus(status: string): QueryResult['status'] {
    const map: Record<string, QueryResult['status']> = {
      SUCCEEDED: 'succeeded', PENDING: 'pending', RUNNING: 'processing',
      FAILED: 'failed', CANCELED: 'failed', UNKNOWN: 'failed',
    };
    return map[status] || 'unknown';
  }
}
