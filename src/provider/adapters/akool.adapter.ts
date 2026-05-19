import { Injectable, Logger } from '@nestjs/common';
import { AxiosInstance } from 'axios';
import { TaskStatus } from '../../common/constants/task-status';
import {
  IProviderAdapter, NormalizedTaskRequest, SubmitResult, QueryResult, CancelResult, RateLimitConfig,
} from '../interfaces/provider-adapter.interface';
import { ProviderConfigService } from '../provider-config.service';
import { createRuntimeConfiguredAxios } from '../create-runtime-axios';
import { AccountPoolService } from '../account-pool/account-pool.service';
import { ErrorLogger } from '../../common/utils/error-logger.util';
import {
  buildAkoolSwapAlgorithmData,
  isAkoolSwapModelId,
  resolveAkoolSwapSubmitOptions,
} from '../../common/utils/akool-swap-input.util';
import { resolveAlgorithmQueueAuth } from '../utils/algorithm-queue-auth.util';
import { buildAlgorithmPublishBody } from '../utils/algorithm-queue-publish.util';

@Injectable()
export class AkoolAdapter implements IProviderAdapter {
  readonly providerName = 'akool';
  private readonly logger = new Logger(AkoolAdapter.name);
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly providerConfig: ProviderConfigService,
    private readonly accountPoolService: AccountPoolService,
  ) {
    this.httpClient = createRuntimeConfiguredAxios(
      this.providerConfig,
      this.providerName,
      { timeout: 30000 },
      undefined,
      this.accountPoolService,
    );
  }

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    const modelKey = request.model;
    const publicModelId = (request.options?.publicModelId as string) || modelKey;
    const opts = resolveAkoolSwapSubmitOptions(publicModelId, request.options);
    const swapModelKey = isAkoolSwapModelId(publicModelId) || isAkoolSwapModelId(modelKey);
    const data = swapModelKey
      ? buildAkoolSwapAlgorithmData(request.input, publicModelId)
      : request.input;

    const teamId = opts.team_id ?? opts.metadata?.team_id ?? 1;
    const uid = opts.uid ?? opts.metadata?.uid ?? 1;

    const body = buildAlgorithmPublishBody({
      algorithmFrom: String(opts.algorithmFrom ?? ''),
      algorithmType: String(opts.algorithmType ?? ''),
      taskName: opts.taskName as string | undefined,
      queueName: opts.queueName as string | undefined,
      priority: Number(opts.priority ?? 0),
      data,
      webhookOverride: (opts.webhook ?? opts.webhookOverride) as string | undefined,
    });

    const account = await this.accountPoolService.selectAccount(this.providerName);
    const authToken = resolveAlgorithmQueueAuth(account, teamId, uid);

    this.logger.debug(
      `Submitting to Akool: model=${modelKey}, swap=${swapModelKey}, team_id=${teamId}, uid=${uid}`,
    );

    const response = await this.httpClient.post('/api/v1/task/publish', body, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    });

    const root = response.data;
    const taskId = root?.task_id ?? root?.data?.task_id ?? root?.id;
    if (taskId == null || taskId === '') {
      const err = new Error(
        `Algorithm queue response missing task_id: ${JSON.stringify(root)?.slice(0, 500)}`,
      );
      ErrorLogger.logError(this.logger, err, { model: modelKey, provider: this.providerName });
      throw Object.assign(err, { response: { status: 502, data: root } });
    }
    return { providerTaskId: String(taskId), isSync: false, rawResponse: root };
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
    const status = providerError?.response?.status;
    const raw = providerError?.response?.data;
    let detail = '';
    if (typeof raw === 'string') detail = raw.slice(0, 500);
    else if (raw && typeof raw === 'object') {
      detail = JSON.stringify(raw.error_msg ?? raw.message ?? raw).slice(0, 500);
    }
    const message =
      [providerError?.message || 'Unknown Akool error', detail].filter(Boolean).join(' | ');
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
