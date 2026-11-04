import { Injectable } from '@nestjs/common';
import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { TaskStatus } from '../../common/constants/task-status';
import { IProviderAdapter, NormalizedTaskRequest, SubmitResult, QueryResult } from '../interfaces/provider-adapter.interface';
import { ProviderConfigService } from '../provider-config.service';
import { AccountPoolService } from '../account-pool/account-pool.service';
import { createRuntimeConfiguredAxios } from '../create-runtime-axios';

const VOICE_MODEL = 'Akool Multilingual 3';
const EMOTIONS = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'];
type AffinityConfig = AxiosRequestConfig & { __preferredAccountId: string };
export interface OpenapiVoice { id: string; name: string; preview?: string; locale?: string; language?: string; model: string }
function reference(parts: string[]) { return `akool-voice:${Buffer.from(JSON.stringify(parts)).toString('base64url')}`; }
function parseReference(value: unknown, count: number): string[] {
  try {
    if (typeof value !== 'string' || !value.startsWith('akool-voice:') || value.length > 500) throw new Error();
    const parts = JSON.parse(Buffer.from(value.slice(12), 'base64url').toString());
    if (!Array.isArray(parts) || parts.length !== count || parts.some(p => typeof p !== 'string' || !/^[\w-]{1,128}$/.test(p))) throw new Error();
    return parts;
  } catch { throw new Error('音色或资源标识无效，请重新选择官方音色'); }
}
function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password) return u.href; } catch { /* invalid supplier output */ }
}

/** VoiceLab v4 only. Account keys stay in the existing admin account pool. */
@Injectable()
export class AkoolOpenapiAdapter implements IProviderAdapter {
  readonly providerName = 'akool-openapi';
  readonly supportsCancellation = false;
  private readonly http: AxiosInstance;
  constructor(private readonly runtime: ProviderConfigService, private readonly accounts: AccountPoolService) {
    this.http = createRuntimeConfiguredAxios(runtime, this.providerName, { timeout: 60000 }, (config, _runtime, credentials) => {
      const u = new URL(config.baseURL || '');
      if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)))) throw new Error('AKOOL OpenAPI 地址必须使用 HTTPS');
      // Admin account overrides commonly include /api. Endpoints below already own
      // that prefix, so accept both documented root and /api without duplicating it.
      const path = u.pathname.replace(/\/+$/, '');
      if (!['', '/api'].includes(path)) throw new Error('AKOOL OpenAPI 地址请填写服务域名或以 /api 结尾，不要填写具体接口路径');
      config.baseURL = u.origin;
      config.maxRedirects = 0; config.maxContentLength = 2 * 1024 * 1024;
      config.headers.delete('Authorization');
      config.headers.set('x-api-key', credentials?.apiKey || '');
    }, accounts, true);
  }
  private affinity(accountId: string): AffinityConfig { return { __preferredAccountId: accountId }; }
  private async readVoice(path: string, config: AffinityConfig): Promise<AxiosResponse> {
    // Two bounded GET attempts fit within the portal's 15-second request window.
    // Keep account affinity and never apply this policy to the paid TTS POST.
    for (let attempt = 0; ; attempt++) {
      try { return await this.http.get(path, { ...config, timeout: 6000 }); }
      catch (error: any) {
        const mapped = this.mapError(error);
        if (attempt === 0 && mapped.retryable) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
        if (!error?.isAxiosError) throw error;
        const failure = new Error(mapped.retryable
          ? '音色服务暂时不可用，尚未提交配音生成，请稍后重试'
          : mapped.message);
        // Preserve safe classification without Axios headers or supplier payloads.
        Object.assign(failure, { config: { method: 'get' }, response: { status: error.response?.status }, code: error.code });
        throw failure;
      }
    }
  }
  private assertEnabled() { if (!this.runtime.getResolvedSync(this.providerName).enabled) throw new Error('akool-openapi 尚未启用，请联系管理员配置供应商'); }
  private unwrap(body: any) {
    if (body?.code !== 1000 || !body.data || typeof body.data !== 'object') {
      // Do not echo supplier payloads, which may contain credentials or request text.
      throw new Error(`AKOOL OpenAPI 请求未成功（业务码 ${Number.isFinite(body?.code) ? body.code : 'unknown'}），请联系管理员检查账号权限与额度`);
    }
    return body.data;
  }
  async voices(page = 1, size = 20) {
    this.assertEnabled();
    if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(size) || size < 1 || size > 50) throw new Error('音色分页参数无效');
    const account = this.accounts.getActiveAccounts(this.providerName)[0];
    if (!account) throw new Error('请管理员在 akool-openapi 账号池配置并启用 API Key');
    const accountId = String(account._id);
    const response = await this.readVoice('/api/open/v4/voice/list', { ...this.affinity(accountId), params: { type: 2, page, size } });
    const data = this.unwrap(response.data);
    if (!Array.isArray(data.result)) throw new Error('供应商音色列表格式无效');
    const items: OpenapiVoice[] = data.result.filter((v: any) => v.status === 3 && v.voice_model_name === VOICE_MODEL && v.voice_id && v._id).map((v: any) => ({
      id: reference([accountId, String(v._id), String(v.voice_id)]), name: String(v.name || '官方音色').slice(0, 100),
      preview: mediaUrl(v.preview), locale: typeof v.locale === 'string' ? v.locale : undefined,
      language: typeof v.language === 'string' ? v.language : undefined, model: VOICE_MODEL,
    }));
    return { items, page, hasMore: Number(data.count) > page * size };
  }
  async validateVoice(input: Record<string, any>) {
    this.assertEnabled();
    const [accountId, documentId, voiceId] = parseReference(input.voice_id, 3);
    if (input.voice_model_name !== VOICE_MODEL) throw new Error('当前仅支持 Akool Multilingual 3 官方音色');
    const response = await this.readVoice(`/api/open/v4/voice/detail/${encodeURIComponent(documentId)}`, this.affinity(accountId));
    const voice = this.unwrap(response.data);
    if (voice.status !== 3 || voice.voice_id !== voiceId || voice.voice_model_name !== VOICE_MODEL) throw new Error('音色已失效或不匹配，请重新选择音色');
    return { accountId, voiceId };
  }
  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    const input = request.input;
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) throw new Error('配音文本不能为空，且不能超过 2000 字');
    if (input.speed !== undefined && (typeof input.speed !== 'number' || input.speed < 0.7 || input.speed > 1.2)) throw new Error('语速范围为 0.7–1.2');
    if (input.volume !== undefined && (!Number.isInteger(input.volume) || input.volume < 0 || input.volume > 100)) throw new Error('生成音量范围为 0–100');
    if (input.emotion !== undefined && !EMOTIONS.includes(input.emotion)) throw new Error('不支持的配音情绪');
    const { accountId, voiceId } = await this.validateVoice(input);
    const options: Record<string, any> = {};
    if (input.speed !== undefined) options.speed = input.speed;
    if (input.volume !== undefined) options.volume = input.volume;
    // VoiceLab documents emotion for Chinese only.
    if (input.emotion !== undefined && input.language_code === 'zh') options.emotion = input.emotion;
    const response = await this.http.post('/api/open/v4/voice/tts', { input_text: input.text, voice_id: voiceId,
      voice_options: options, ...(input.language_code ? { language_code: input.language_code } : {}) }, this.affinity(accountId));
    const data = this.unwrap(response.data);
    if (typeof data._id !== 'string' || !/^[\w-]{1,128}$/.test(data._id)) throw new Error('供应商提交结果缺少资源 ID，请联系管理员核对任务，避免重复制作');
    return { providerTaskId: reference([accountId, data._id]), isSync: false, rawResponse: { code: response.data.code, data: { _id: data._id, status: data.status } } };
  }
  async queryTask(providerTaskId: string): Promise<QueryResult> {
    const [accountId, resourceId] = parseReference(providerTaskId, 2);
    const response = await this.http.get(`/api/open/v4/voice/resource/detail/${encodeURIComponent(resourceId)}`, this.affinity(accountId));
    const data = this.unwrap(response.data), resource = data.result;
    const statuses: Record<number, QueryResult['status']> = { 1: 'pending', 2: 'processing', 3: 'succeeded', 4: 'failed' };
    const status = statuses[resource?.status] || 'unknown';
    const audio = mediaUrl(resource?.preview);
    if (status === 'succeeded' && !audio) return { status: 'failed', error: { code: 'AKOOL_OPENAPI_EMPTY_AUDIO', message: '配音任务已结束，但未返回有效音频，请联系管理员检查' } };
    return { status, ...(status === 'succeeded' ? { result: { audio, duration: Number(resource.duration) / 1000 } } : {}),
      ...(status === 'failed' ? { error: { code: 'AKOOL_OPENAPI_TTS_FAILED', message: '供应商配音失败，请检查音色与文本后重试' } } : {}) };
  }
  async cancelTask() { return { accepted: false, message: '供应商未提供配音取消接口，已提交任务请等待结果' }; }
  mapStatus(status: string): TaskStatus { return ({ pending: TaskStatus.SUBMITTED, processing: TaskStatus.PROCESSING, succeeded: TaskStatus.SUCCESS, failed: TaskStatus.FAILED } as const)[status] || TaskStatus.PROCESSING; }
  mapError(error: any) {
    const status = error?.response?.status;
    const readOnly = error?.config?.method?.toLowerCase() === 'get';
    return { code: `AKOOL_OPENAPI_${status || 'ERR'}`, message: status ? `AKOOL OpenAPI 请求失败（HTTP ${status}），请管理员检查供应商凭证、权限与额度` : error?.isAxiosError ? '配音提交结果未确认，请联系管理员核对供应商任务后再重试，避免重复制作' : error?.message || '配音请求失败',
      // POST timeouts/5xx may have already created a chargeable resource. Never retry them automatically.
      retryable: status === 429 || readOnly && (status >= 500 && status < 600 || ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(error?.code)) };
  }
  getRateLimitConfig() { return this.runtime.getSubmitLimitsSync(this.providerName); }
}
