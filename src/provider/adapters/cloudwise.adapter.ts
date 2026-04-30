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

@Injectable()
export class CloudwiseAdapter implements IProviderAdapter {
  readonly providerName = 'cloudwise';
  private readonly logger = new Logger(CloudwiseAdapter.name);
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly providerConfig: ProviderConfigService,
    private readonly accountPoolService: AccountPoolService,
  ) {
    this.httpClient = createRuntimeConfiguredAxios(
      this.providerConfig,
      this.providerName,
      { timeout: 60000 },
      undefined,
      this.accountPoolService,
    );
  }

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    const featureType = request.options?.featureType || 'textToImage';
    const modelName = this.resolveModelName(request.model);

    if (featureType === 'textToImage' || featureType === 'imageToImage') {
      return this.generateContent(modelName, request.input, featureType);
    }

    const body = { model: modelName, ...request.input };
    this.logger.log(`Submit: ${request.model} → Cloudwise`);
    const response = await this.httpClient.post(`/v1/videos/generations`, body);
    return { providerTaskId: response.data.id || response.data.task_id, isSync: false, rawResponse: response.data };
  }

  private async generateContent(modelName: string, input: Record<string, any>, featureType: string): Promise<SubmitResult> {
    const parts: any[] = [{ text: input.prompt || '' }];

    if (featureType === 'imageToImage' && (input.image || input.images?.length)) {
      const imageUrls = input.images || [input.image];
      for (const url of imageUrls) {
        parts.push({ inline_data: { mime_type: 'image/png', data: url } });
      }
    }

    const generationConfig: any = { responseModalities: ['TEXT', 'IMAGE'] };
    if (input.aspect_ratio || input.resolution) {
      generationConfig.imageConfig = {
        ...(input.aspect_ratio ? { aspectRatio: input.aspect_ratio } : {}),
        ...(input.resolution ? { imageSize: input.resolution } : {}),
      };
    }

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig,
      return_base64: false,
    };

    this.logger.log(`Submit: Cloudwise generateContent model=${modelName}`);
    const response = await this.httpClient.post(`/v1beta/models/${modelName}:generateContent`, body);
    const data = response.data;

    const outputs = this.extractOutputs(data);
    if (outputs.length > 0) {
      return { providerTaskId: data.responseId || `sync-${Date.now()}`, isSync: true, result: { output: outputs }, rawResponse: data };
    }

    return { providerTaskId: data.responseId || data.id || `cw-${Date.now()}`, isSync: false, rawResponse: data };
  }

  async queryTask(providerTaskId: string): Promise<QueryResult> {
    const response = await this.httpClient.get(`/v1/videos/${providerTaskId}/content`);
    const data = response.data;
    return { status: this.mapQueryStatus(data.status), result: data.output, rawResponse: data };
  }

  async cancelTask(): Promise<CancelResult> { return { accepted: false, message: 'Not supported' }; }

  mapStatus(providerStatus: string): TaskStatus {
    const map: Record<string, TaskStatus> = {
      pending: TaskStatus.SUBMITTED, queued: TaskStatus.SUBMITTED,
      running: TaskStatus.PROCESSING, completed: TaskStatus.SUCCESS, failed: TaskStatus.FAILED,
    };
    return map[providerStatus] || TaskStatus.PROCESSING;
  }

  mapError(providerError: any) {
    const message = providerError?.response?.data?.error || providerError?.message || 'Cloudwise error';
    const status = providerError?.response?.status;
    return { code: `CLOUDWISE_${status || 'ERR'}`, message, retryable: status === 429 || status >= 500 };
  }

  getRateLimitConfig(): RateLimitConfig {
    return this.providerConfig.getSubmitLimitsSync(this.providerName);
  }

  private resolveModelName(model: string): string {
    const parts = model.split('/');
    if (parts[0] === 'cloudwise') parts.shift();
    const features = ['text-to-image', 'image-to-image'];
    if (features.includes(parts[parts.length - 1])) parts.pop();
    return parts.join('/');
  }

  private extractOutputs(data: any): string[] {
    if (!data?.candidates) return [];
    const outputs: string[] = [];
    for (const candidate of data.candidates) {
      for (const part of candidate.content?.parts || []) {
        if (part.inline_data?.data) outputs.push(part.inline_data.data);
        else if (part.fileData?.fileUri) outputs.push(part.fileData.fileUri);
      }
    }
    return outputs;
  }

  private mapQueryStatus(status: string): QueryResult['status'] {
    const map: Record<string, QueryResult['status']> = {
      pending: 'pending', queued: 'pending', running: 'processing',
      completed: 'succeeded', failed: 'failed',
    };
    return map[status] || 'unknown';
  }
}
