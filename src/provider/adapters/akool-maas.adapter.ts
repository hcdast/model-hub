import { Injectable } from '@nestjs/common';
import { AxiosInstance } from 'axios';
import { TaskStatus } from '../../common/constants/task-status';
import { IProviderAdapter, NormalizedTaskRequest, SubmitResult, QueryResult, RateLimitConfig } from '../interfaces/provider-adapter.interface';
import { ProviderConfigService } from '../provider-config.service';
import { AccountPoolService } from '../account-pool/account-pool.service';
import { createRuntimeConfiguredAxios } from '../create-runtime-axios';

/** AKOOL MaaS /api/v1/run protocol; independent of the direct Volcengine Ark adapter. */
@Injectable()
export class AkoolMaasAdapter implements IProviderAdapter {
  readonly providerName = 'akool-maas';
  readonly supportsCancellation = false;
  private readonly httpClient: AxiosInstance;
  private readonly llmClient: AxiosInstance;

  constructor(private readonly providerConfig: ProviderConfigService, accountPool: AccountPoolService) {
    this.httpClient = createRuntimeConfiguredAxios(providerConfig, this.providerName, { timeout: 60000 }, (config) => {
      if (!config.baseURL) throw new Error('Configure akool-maas base_url including /api/v1');
    }, accountPool, true);
    this.llmClient = createRuntimeConfiguredAxios(providerConfig, this.providerName, { timeout: 60000 }, (config, runtime) => {
      // LLM has its own host. Never derive it from the media URL or a user request.
      const base = runtime.extra?.llm_base_url;
      if (typeof base !== 'string' || !base.trim()) throw new Error('Configure akool-maas extra.llm_base_url including /v1 before using LLM models');
      const url = new URL(base);
      if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('MaaS LLM base URL must use HTTPS without credentials, query or fragment');
      config.baseURL = base.replace(/\/+$/, '');
      config.maxRedirects = 0;
      config.maxContentLength = 2 * 1024 * 1024;
    }, accountPool, true);
  }

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    if (request.input.maas_protocol === 'chat-completions') return this.submitChat(request);
    if (request.input.maas_protocol !== undefined) throw new Error('Unsupported MaaS protocol');
    // Imported capability configs can share a MaaS endpoint (e.g. Wan /video).
    // The hidden, enum-constrained model default is resolved by task validation.
    const { model: inputModel, ...input } = request.input;
    const upstreamModel = typeof inputModel === 'string' && inputModel.trim() ? inputModel : request.model;
    const response = await this.httpClient.post(`/run/${encodeURIComponent(upstreamModel)}`, { input }, {
      // Stable across queue retries; supported by the MaaS gateway.
      headers: { 'Idempotency-Key': request.taskId, 'X-Client-Reference': request.taskId },
    });
    const data = this.unwrap(response.data);
    if (typeof data?.task_uuid !== 'string' || !data.task_uuid.trim()) {
      throw new Error(this.errorMessage(data) || 'MaaS submission missing task_uuid');
    }
    return { providerTaskId: data.task_uuid, isSync: false, rawResponse: response.data };
  }

  private async submitChat(request: NormalizedTaskRequest): Promise<SubmitResult> {
    const { model: selector, prompt, messages, maas_protocol, ...parameters } = request.input;
    if (parameters.stream === true) throw new Error('MaaS task execution requires non-streaming LLM responses');
    const model = typeof selector === 'string' && selector.trim() ? selector : request.model;
    const conversation = messages ?? (typeof prompt === 'string' && prompt.trim() ? [{ role: 'user', content: prompt }] : undefined);
    if (!Array.isArray(conversation) || !conversation.length) throw new Error('MaaS LLM requires messages or a non-empty prompt');
    const allowed = ['temperature', 'max_tokens', 'top_p', 'top_k', 'presence_penalty', 'frequency_penalty', 'stop', 'tools', 'tool_choice', 'user'];
    const body = Object.fromEntries(Object.entries(parameters).filter(([name]) => allowed.includes(name)));
    const response = await this.llmClient.post('/chat/completions', { ...body, model, messages: conversation, stream: false }, {
      headers: { 'Idempotency-Key': request.taskId, 'X-Client-Reference': request.taskId },
    });
    const data = this.unwrap(response.data);
    if (!Array.isArray(data?.choices) || !data.choices.length || !data.choices[0]?.message) throw new Error(this.errorMessage(data) || 'MaaS LLM response missing choices');
    // Keep finish_reason and complete token usage for review and settlement.
    return { providerTaskId: typeof data.id === 'string' && data.id ? data.id : request.taskId, isSync: true, result: data, rawResponse: response.data };
  }

  async queryTask(providerTaskId: string): Promise<QueryResult> {
    const response = await this.httpClient.get(`/run/tasks/${encodeURIComponent(providerTaskId)}`);
    const data = this.unwrap(response.data);
    const status = this.queryStatus(data?.status);
    return {
      status,
      progress: typeof data?.progress === 'number' ? data.progress : undefined,
      result: status === 'succeeded' ? data.output : undefined,
      error: status === 'failed' ? { code: 'MAAS_FAILED', message: this.errorMessage(data) || 'MaaS task failed' } : undefined,
      rawResponse: response.data,
    };
  }

  async cancelTask() { return { accepted: false, message: 'MaaS cancellation endpoint is not documented' }; }

  mapStatus(status: string): TaskStatus {
    const map: Record<string, TaskStatus> = { pending: TaskStatus.SUBMITTED, processing: TaskStatus.PROCESSING,
      completed: TaskStatus.SUCCESS, failed: TaskStatus.FAILED, cancelled: TaskStatus.CANCELLED };
    return map[status] || TaskStatus.PROCESSING;
  }

  mapError(error: any) {
    const status = error?.response?.status;
    const body = error?.response?.data;
    return { code: `MAAS_${status || 'ERR'}`, message: this.errorMessage(body?.data || body) || error?.message || 'MaaS error',
      retryable: status === 429 || (status >= 500 && status < 600) || ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(error?.code) };
  }

  getRateLimitConfig(): RateLimitConfig { return this.providerConfig.getSubmitLimitsSync(this.providerName); }

  private unwrap(body: any): any {
    if (body?.code != null && ![0, 200, 1000].includes(body.code)) throw new Error(this.errorMessage(body) || 'MaaS request rejected');
    return body?.data && typeof body.data === 'object' ? body.data : body;
  }

  private errorMessage(body: any): string | undefined {
    return [body?.error_message, body?.error?.message, body?.message, body?.msg, body?.detail]
      .find(value => typeof value === 'string' && value.trim());
  }

  private queryStatus(status: string): QueryResult['status'] {
    return ({ pending: 'pending', processing: 'processing', completed: 'succeeded', failed: 'failed', cancelled: 'cancelled' } as const)[status] || 'unknown';
  }
}
