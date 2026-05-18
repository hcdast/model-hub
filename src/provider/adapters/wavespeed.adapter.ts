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
import { inferCamelFeatureFromPathSegment } from '../../common/utils/model-path-infer.util';

@Injectable()
export class WaveSpeedAdapter implements IProviderAdapter {
  readonly providerName = 'wavespeed-ai';
  private readonly logger = new Logger(WaveSpeedAdapter.name);
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
    const featureType = request.options?.featureType || this.inferFeature(request.model);
    const modelPath = this.resolveModelPath(request.model);
    const body = this.transformInput(request.input, featureType, request.options);

    this.logger.log(`Submit: ${request.model} → POST /${modelPath} (${featureType})`);
    const response = await this.httpClient.post(`/${modelPath}`, body);

    const root = response.data;
    const payload = this.unwrapWsEnvelope(root);
    const id = payload?.id ?? root?.id;
    if (id == null || id === '') {
      const error = new Error('WaveSpeed response missing prediction id');
      ErrorLogger.logError(
        this.logger,
        error,
        { model: request.model, provider: this.providerName },
        'WaveSpeed submit: missing prediction id',
      );
      throw Object.assign(error, {
        response: { status: 502, data: root },
      });
    }
    return { providerTaskId: String(id), isSync: false, rawResponse: root };
  }

  async queryTask(providerTaskId: string): Promise<QueryResult> {
    const response = await this.httpClient.get(`/predictions/${providerTaskId}/result`);
    const root = response.data;
    const data = this.unwrapWsEnvelope(root);
    return {
      status: this.mapQueryStatus(data.status),
      progress: data.progress || 0,
      result: data.output || data.outputs,
      rawResponse: root,
    };
  }

  async cancelTask(providerTaskId: string): Promise<CancelResult> {
    try { await this.httpClient.post(`/predictions/${providerTaskId}/cancel`); return { accepted: true }; }
    catch { return { accepted: false, message: 'Cancel not supported' }; }
  }

  mapStatus(providerStatus: string): TaskStatus {
    const map: Record<string, TaskStatus> = {
      created: TaskStatus.SUBMITTED, processing: TaskStatus.PROCESSING,
      completed: TaskStatus.SUCCESS, failed: TaskStatus.FAILED,
    };
    return map[providerStatus] || TaskStatus.PROCESSING;
  }

  mapError(providerError: any) {
    const status = providerError?.response?.status;
    const raw = providerError?.response?.data;
    const cfg = providerError?.config;
    const reqPath = cfg ? `${cfg.baseURL || ''}${cfg.url || ''}` : '';

    let message = '';
    const data = Buffer.isBuffer(raw)
      ? raw.toString('utf8')
      : raw;

    if (typeof data === 'string') {
      message = data.trim().slice(0, 2000);
    } else if (data && typeof data === 'object') {
      const m = data.message ?? data.msg ?? data.error;
      if (typeof m === 'string') message = m;
      else if (m != null && typeof m === 'object') message = JSON.stringify(m);
      else message = JSON.stringify(data);
    }

    if (!message) message = providerError?.message || 'WaveSpeed error';
    if (reqPath) message = `${message} [${reqPath}]`;

    return { code: `WAVESPEED_${status || 'ERR'}`, message, retryable: status === 429 || status >= 500 };
  }

  getRateLimitConfig(): RateLimitConfig {
    return this.providerConfig.getSubmitLimitsSync(this.providerName);
  }

  /**
   * 成功响应多为 { code, message, data: { id, ... } }；错误常为 { code, message } 且 data 为 null。
   * 仅在 data 为非 null 对象时解包，否则返回根对象供读取 message。
   */
  private unwrapWsEnvelope(root: any): any {
    if (root == null || typeof root !== 'object') return root;
    const inner = root.data;
    if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) return inner;
    return root;
  }

  /** WaveSpeed v3 路径需保留完整模型标识（含 wavespeed-ai/ 前缀），如 wavespeed-ai/flux-2-pro/text-to-image */
  private resolveModelPath(model: string): string {
    return model;
  }

  private inferFeature(model: string): string {
    const last = model.split('/').pop() || '';
    return inferCamelFeatureFromPathSegment(last);
  }

  private transformInput(input: Record<string, any>, featureType: string, options?: Record<string, any>): Record<string, any> {
    const { prompt, negative_prompt, image, images, aspect_ratio, resolution, duration,
      generate_audio, seed, guidance_scale, cfg_scale, video, last_image, end_image,
      face_image, pose_image, sound, movement_amplitude, bgm, multi_prompt, element_list,
      ...rest } = input;

    // 仅保留 WaveSpeed API 已知字段，过滤掉上游传入的未知字段（如 scale）避免 400
    const knownRestKeys = new Set([
      'width', 'height', 'num_outputs', 'output_format', 'output_quality',
      'num_inference_steps', 'disable_safety_checker', 'style',
    ]);
    const body: Record<string, any> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (knownRestKeys.has(k) && v !== '' && v !== undefined && v !== null) body[k] = v;
    }

    if (prompt !== undefined) body.prompt = prompt;
    if (negative_prompt) body.negative_prompt = negative_prompt;
    if (seed !== undefined) body.seed = seed;

    switch (featureType) {
      case 'textToImage':
      case 'imageToImage':
        if (image) body.image = image;
        if (images?.length) body.images = images;
        if (aspect_ratio) body.aspect_ratio = aspect_ratio;
        if (resolution) body.size = resolution;
        break;

      case 'textToVideo':
      case 'imageToVideo':
      case 'videoToVideo':
        if (image) body.image = image;
        if (video) body.video = video;
        if (duration) body.duration = duration;
        if (aspect_ratio) body.aspect_ratio = aspect_ratio;
        if (resolution) body.resolution = resolution;
        if (generate_audio !== undefined) body.generate_audio = generate_audio;
        if (sound !== undefined) body.sound = sound;
        if (cfg_scale) body.cfg_scale = cfg_scale;
        if (guidance_scale) body.guidance_scale = guidance_scale;
        if (last_image) body.last_image = last_image;
        if (end_image) body.end_image = end_image;
        if (multi_prompt?.length) body.multi_prompt = multi_prompt;
        if (element_list?.length) body.element_list = element_list;
        if (movement_amplitude) body.movement_amplitude = movement_amplitude;
        if (bgm) body.bgm = bgm;
        break;

      case 'characterSwap':
      case 'characterFaceswap':
        if (image) body.image = image;
        if (face_image) body.face_image = face_image;
        if (pose_image) body.pose_image = pose_image;
        if (duration) body.duration = duration;
        if (aspect_ratio) body.aspect_ratio = aspect_ratio;
        break;

      case 'videoUpscale':
        if (video || image) body.video = video || image;
        if (resolution) body.resolution = resolution;
        break;
    }

    this.mergeWhitelistedWaveOptions(body, options);

    if (featureType === 'textToImage' || featureType === 'imageToImage') {
      if (body.enable_sync_mode === undefined) body.enable_sync_mode = false;
      if (body.enable_base64_output === undefined) body.enable_base64_output = false;
      if (typeof body.size === 'string') body.size = body.size.replace(/x/gi, '*');
    }

    return body;
  }

  /** 仅转发 WaveSpeed 文档支持的 options 字段，避免把 featureType 等内部字段塞进请求体导致 400。 */
  private mergeWhitelistedWaveOptions(body: Record<string, any>, options?: Record<string, any>): void {
    if (!options || typeof options !== 'object') return;
    const skip = new Set(['featureType', 'metadata', 'callbackUrl', 'callbackSecret', 'priority']);
    const allow = new Set([
      'size', 'quality', 'seed', 'enable_sync_mode', 'enable_base64_output',
      'negative_prompt', 'aspect_ratio', 'duration', 'generate_audio', 'cfg_scale', 'guidance_scale',
    ]);
    for (const [k, v] of Object.entries(options)) {
      if (skip.has(k) || v === undefined) continue;
      if (allow.has(k)) body[k] = v;
    }
  }

  private mapQueryStatus(status: string): QueryResult['status'] {
    const map: Record<string, QueryResult['status']> = {
      created: 'pending', processing: 'processing', completed: 'succeeded', failed: 'failed',
    };
    return map[status] || 'unknown';
  }
}
