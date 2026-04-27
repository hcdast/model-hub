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
export class AkoolAdapter implements IProviderAdapter {
  readonly providerName = 'akool';
  private readonly logger = new Logger(AkoolAdapter.name);
  private readonly httpClient: AxiosInstance;

  constructor(private readonly providerConfig: ProviderConfigService) {
    this.httpClient = createRuntimeConfiguredAxios(
      this.providerConfig,
      this.providerName,
      { timeout: 30000 },
    );
  }

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    const body = {
      algorithmFrom: request.options?.algorithmFrom, algorithmType: request.options?.algorithmType,
      priority: request.options?.priority || 0, data: request.input,
      webhookOverride: request.options?.webhook, queueName: request.options?.queueName, taskName: request.options?.taskName,
    };
    this.logger.debug(`Submitting to Akool: model=${request.model}`);
    const response = await this.httpClient.post('/api/v1/task/publish', body);
    return { providerTaskId: response.data.task_id || response.data.id, isSync: false, rawResponse: response.data };
  }

  async queryTask(providerTaskId: string, meta?: Record<string, any>): Promise<QueryResult> {
    const subProvider = meta?.subProvider || 'akool';
    const response = await this.httpClient.get('/api/v1/itv/status', { params: { provider: subProvider, task_id: providerTaskId } });
    const data = response.data;
    return { status: this.mapQueryStatus(data.status), result: data.output, rawResponse: data };
  }

  async cancelTask(): Promise<CancelResult> { return { accepted: false, message: 'Akool cancel not yet supported' }; }

  mapStatus(providerStatus: string): TaskStatus {
    const map: Record<string, TaskStatus> = { queued: TaskStatus.SUBMITTED, processing: TaskStatus.PROCESSING, done: TaskStatus.SUCCESS, succeeded: TaskStatus.SUCCESS, failed: TaskStatus.FAILED, error: TaskStatus.FAILED };
    return map[providerStatus] || TaskStatus.PROCESSING;
  }

  mapError(providerError: any) {
    const message = providerError?.response?.data?.message || providerError?.message || 'Unknown Akool error';
    const status = providerError?.response?.status;
    return { code: `AKOOL_${status || 'ERR'}`, message, retryable: status === 429 || status >= 500 };
  }

  getRateLimitConfig(): RateLimitConfig {
    return this.providerConfig.getSubmitLimitsSync(this.providerName);
  }

  private mapQueryStatus(status: string): QueryResult['status'] {
    const map: Record<string, QueryResult['status']> = { queued: 'pending', processing: 'processing', done: 'succeeded', succeeded: 'succeeded', failed: 'failed', error: 'failed' };
    return map[status] || 'unknown';
  }
}
