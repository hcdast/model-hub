import { Injectable, Logger } from '@nestjs/common';
import { AxiosHeaders, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { TaskStatus } from '../../common/constants/task-status';
import {
  IProviderAdapter, NormalizedTaskRequest, SubmitResult, QueryResult, CancelResult, RateLimitConfig,
} from '../interfaces/provider-adapter.interface';
import { ProviderConfigService } from '../provider-config.service';
import { ResolvedProviderRuntime } from '../provider-config.types';
import { createRuntimeConfiguredAxios } from '../create-runtime-axios';
import { AccountPoolService } from '../account-pool/account-pool.service';
import { ResolvedAccountCredentials } from '../account-pool/resolved-account-credentials.interface';
import { ErrorLogger } from '../../common/utils/error-logger.util';

@Injectable()
export class MiniMaxAdapter implements IProviderAdapter {
  readonly providerName = 'minimax';
  private readonly logger = new Logger(MiniMaxAdapter.name);
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly providerConfig: ProviderConfigService,
    private readonly accountPoolService: AccountPoolService,
  ) {
    this.httpClient = createRuntimeConfiguredAxios(
      this.providerConfig,
      this.providerName,
      { timeout: 60000 },
      (config: InternalAxiosRequestConfig, _r: ResolvedProviderRuntime, credentials?: ResolvedAccountCredentials) => {
        const h = AxiosHeaders.from(config.headers ?? {});
        const bizId = credentials?.extraCredentials?.bizId as string | undefined;
        if (bizId) h.set('X-Biz-Id', bizId);
        else h.delete('X-Biz-Id');
        config.headers = h;
      },
      this.accountPoolService,
    );
  }

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    const featureType = request.options?.featureType || this.inferFeature(request.model);
    const modelName = this.resolveModelName(request.model);

    if (featureType === 'textToImage' || featureType === 'imageToImage') {
      return this.generateImage(modelName, request.input, featureType);
    }

    return this.generateVideo(modelName, request.input);
  }

  private async generateImage(modelName: string, input: Record<string, any>, featureType: string): Promise<SubmitResult> {
    const parts: any[] = [{ text: input.prompt || '' }];

    if (featureType === 'imageToImage' && input.image) {
      parts.push({ inline_data: { mime_type: 'image/png', data: input.image } });
    }

    const generationConfig: any = { responseModalities: ['TEXT', 'IMAGE'] };
    if (input.aspect_ratio) generationConfig.imageConfig = { aspectRatio: input.aspect_ratio };

    const body = { contents: [{ role: 'user', parts }], generationConfig, return_base64: false };

    this.logger.log(`Submit: MiniMax image model=${modelName}`);
    const response = await this.httpClient.post(`/v1/gemini/v1beta/models/${modelName}:generateContent`, body);
    const data = response.data;

    const outputs = this.extractOutputs(data);
    if (outputs.length > 0) {
      return { providerTaskId: `minimax-sync-${Date.now()}`, isSync: true, result: { output: outputs }, rawResponse: data };
    }

    return { providerTaskId: data.id || `minimax-${Date.now()}`, isSync: false, rawResponse: data };
  }

  private async generateVideo(modelName: string, input: Record<string, any>): Promise<SubmitResult> {
    const body: Record<string, any> = {
      prompt: input.prompt || '',
      model: modelName,
    };
    if (input.image) body.first_frame_image = input.image;
    if (input.aspect_ratio) body.aspect_ratio = input.aspect_ratio;
    if (input.resolution) body.resolution = input.resolution;
    if (input.duration) body.duration_seconds = input.duration;
    if (input.generate_audio !== undefined) body.generate_audio = input.generate_audio;
    if (input.negative_prompt) body.negative_prompt = input.negative_prompt;

    this.logger.log(`Submit: MiniMax video model=${modelName}`);
    const response = await this.httpClient.post('/v1/g-method/video/generations', body);
    const data = response.data;

    return { providerTaskId: data.task_id || data.id, isSync: false, rawResponse: data };
  }

  async queryTask(providerTaskId: string): Promise<QueryResult> {
    const response = await this.httpClient.get(`/v1/videos/${providerTaskId}/result`);
    const data = response.data;
    return {
      status: this.mapQueryStatus(data.status),
      progress: data.progress,
      result: data.output || data.file_id,
      rawResponse: data,
    };
  }

  async cancelTask(): Promise<CancelResult> { return { accepted: false, message: 'Not supported' }; }

  mapStatus(providerStatus: string): TaskStatus {
    const map: Record<string, TaskStatus> = {
      queued: TaskStatus.SUBMITTED, pending: TaskStatus.SUBMITTED,
      in_progress: TaskStatus.PROCESSING, processing: TaskStatus.PROCESSING,
      completed: TaskStatus.SUCCESS, failed: TaskStatus.FAILED,
    };
    return map[providerStatus] || TaskStatus.PROCESSING;
  }

  mapError(providerError: any) {
    const message = providerError?.response?.data?.base_resp?.status_msg || providerError?.message || 'MiniMax error';
    const status = providerError?.response?.status;
    return { code: `MINIMAX_${status || 'ERR'}`, message, retryable: status === 429 || status >= 500 };
  }

  getRateLimitConfig(): RateLimitConfig {
    return this.providerConfig.getSubmitLimitsSync(this.providerName);
  }

  private inferFeature(model: string): string {
    const last = model.split('/').pop() || '';
    if (last.includes('video')) return 'textToVideo';
    return 'textToImage';
  }

  private resolveModelName(model: string): string {
    const parts = model.split('/');
    if (parts[0] === 'minimax') parts.shift();
    const features = ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video'];
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
      queued: 'pending', pending: 'pending', in_progress: 'processing',
      processing: 'processing', completed: 'succeeded', failed: 'failed',
    };
    return map[status] || 'unknown';
  }
}
