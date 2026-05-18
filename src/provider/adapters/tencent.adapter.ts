import { Injectable, Logger } from '@nestjs/common';
import { TaskStatus } from '../../common/constants/task-status';
import {
  IProviderAdapter,
  NormalizedTaskRequest,
  SubmitResult,
  QueryResult,
  CancelResult,
  RateLimitConfig,
} from '../interfaces/provider-adapter.interface';
import { ProviderConfigService } from '../provider-config.service';
import { AccountPoolService } from '../account-pool/account-pool.service';
import { ResolvedAccountCredentials } from '../account-pool/resolved-account-credentials.interface';
import { ErrorLogger } from '../../common/utils/error-logger.util';
import { normalizeCharacterSwapModelPath } from '../../common/utils/model-path-infer.util';

// 腾讯云 SDK 类型定义
interface TencentCredential {
  secretId: string;
  secretKey: string;
}

interface TencentClientConfig {
  credential: TencentCredential;
  region?: string;
  profile?: {
    httpProfile?: {
      endpoint?: string;
      reqTimeout?: number;
    };
  };
}

interface FileInfo {
  Type: string;
  Category: string;
  Url: string;
}

interface CreateAigcVideoTaskRequest {
  SubAppId: number;
  ModelName: string;
  ModelVersion: string;
  FileInfos: FileInfo[];
  Prompt: string;
  OutputConfig: {
    StorageMode: string;
    Resolution: string;
  };
  SceneType: string;
  ExtInfo?: string;
}

interface CreateAigcVideoTaskResponse {
  TaskId: string;
  RequestId?: string;
}

interface DescribeTaskDetailRequest {
  SubAppId: number;
  TaskId: string;
}

interface AigcVideoTask {
  ErrCode?: number;
  Message?: string;
  Output?: {
    FileInfos?: Array<{
      FileUrl?: string;
      MetaData?: {
        Duration?: number;
      };
    }>;
  };
}

interface DescribeTaskDetailResponse {
  Status: string;
  AigcVideoTask?: AigcVideoTask;
  RequestId?: string;
}

/**
 * Model name → Tencent VOD API parameter mapping
 */
type TencentKlingModelParams = { version: string; mode: string; resolution: string };

const TENCENT_KLING_MODEL_SPECS: Array<{ base: string; params: TencentKlingModelParams }> = [
  { base: 'kling-v3.0-pro', params: { version: '3.0', mode: 'pro', resolution: '1080p' } },
  { base: 'kling-v3.0-std', params: { version: '3.0', mode: 'std', resolution: '1080p' } },
  { base: 'kling-v2.6-pro', params: { version: '2.6', mode: 'pro', resolution: '1080p' } },
  { base: 'kling-v2.6-std', params: { version: '2.6', mode: 'std', resolution: '1080p' } },
];

/** 支持 provider_model_name（motion-control）与路径型兼容键 */
function buildTencentKlingModelMap(): Record<string, TencentKlingModelParams> {
  const map: Record<string, TencentKlingModelParams> = {};
  for (const { base, params } of TENCENT_KLING_MODEL_SPECS) {
    for (const suffix of ['characterswap', 'character-swap', 'motion-control']) {
      map[`tencent-cloud/${base}/${suffix}`] = params;
      map[`tencent/${base}/${suffix}`] = params;
      map[`${base}/${suffix}`] = params;
    }
  }
  return map;
}

const TencentKlingModelMap = buildTencentKlingModelMap();

function resolveTencentKlingModel(model: string): TencentKlingModelParams | undefined {
  return (
    TencentKlingModelMap[model] ??
    TencentKlingModelMap[normalizeCharacterSwapModelPath(model)]
  );
}

/**
 * 用于缓存 VOD 客户端的 key，避免每次请求都重新创建
 */
function buildClientCacheKey(secretId: string, region: string): string {
  return `${secretId}:${region}`;
}

@Injectable()
export class TencentAdapter implements IProviderAdapter {
  readonly providerName = 'tencent-cloud';
  private readonly logger = new Logger(TencentAdapter.name);

  /** 按 secretId+region 缓存已初始化的 VOD 客户端，避免重复创建 */
  private readonly clientCache = new Map<string, any>();
  /** 正在初始化中的 Promise，防止并发重复初始化 */
  private readonly initPromises = new Map<string, Promise<any>>();

  constructor(
    private readonly providerConfig: ProviderConfigService,
    private readonly accountPoolService: AccountPoolService,
  ) {}

  /**
   * 从账号池获取凭证，构建 ResolvedAccountCredentials。
   * 密钥的唯一来源是 account_pool_entries.extra_credentials。
   */
  private async resolveCredentials(): Promise<{
    credentials: ResolvedAccountCredentials;
    secretId: string;
    secretKey: string;
    region: string;
    subAppId: number;
    accountId: string;
  }> {
    const account = await this.accountPoolService.selectAccount(this.providerName);
    if (!account) {
      throw new Error(
        `Provider "${this.providerName}" has no available account pool entries. ` +
        `Please add at least one account in the Account Pool management page.`,
      );
    }

    const credentials: ResolvedAccountCredentials = {
      apiKey: account.api_key,
      extraCredentials: (account as any).extra_credentials || {},
      accountId: (account as any)._id?.toString?.() ?? '',
      accountAlias: account.account_alias,
    };

    const { secretId, secretKey, region, subAppId } = credentials.extraCredentials as Record<string, any>;

    if (!secretId || !secretKey) {
      throw new Error(
        `Tencent Cloud account "${credentials.accountAlias}" is missing secretId/secretKey in extra_credentials. ` +
        `Please configure them in the Account Pool management page.`,
      );
    }

    return {
      credentials,
      secretId: String(secretId),
      secretKey: String(secretKey),
      region: String(region || ''),
      subAppId: Number(subAppId) || 0,
      accountId: credentials.accountId,
    };
  }

  /**
   * 获取或创建 VOD 客户端（按 secretId+region 缓存）
   */
  private async getOrCreateClient(secretId: string, secretKey: string, region: string): Promise<any> {
    const cacheKey = buildClientCacheKey(secretId, region);

    // 已缓存的客户端直接返回
    const cached = this.clientCache.get(cacheKey);
    if (cached) return cached;

    // 正在初始化中，等待完成
    const pending = this.initPromises.get(cacheKey);
    if (pending) return pending;

    // 创建新客户端
    const initPromise = this.createVodClient(secretId, secretKey, region);
    this.initPromises.set(cacheKey, initPromise);

    try {
      const client = await initPromise;
      this.clientCache.set(cacheKey, client);
      return client;
    } finally {
      this.initPromises.delete(cacheKey);
    }
  }

  /**
   * 创建腾讯云 VOD 客户端实例
   */
  private async createVodClient(secretId: string, secretKey: string, region: string): Promise<any> {
    try {
      // 动态导入 SDK，避免在未安装时报错
      const { vod } = await import('tencentcloud-sdk-nodejs-vod');
      const VodClient = vod.v20180717.Client;

      const clientConfig: TencentClientConfig = {
        credential: {
          secretId,
          secretKey,
        },
        region: region || '',
        profile: {
          httpProfile: {
            endpoint: 'vod.tencentcloudapi.com',
            reqTimeout: 60,
          },
        },
      };

      const client = new VodClient(clientConfig);
      this.logger.log(`Tencent Cloud VOD client created for secretId=${secretId.substring(0, 6)}***`);
      return client;
    } catch (error: any) {
      ErrorLogger.logError(
        this.logger,
        error,
        { provider: this.providerName },
        'Tencent Cloud SDK initialization failed. Install with: npm install tencentcloud-sdk-nodejs-vod',
      );
      throw error;
    }
  }

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    // 从账号池获取凭证（密钥唯一来源：extra_credentials）
    const { secretId, secretKey, region, subAppId, accountId } = await this.resolveCredentials();
    const vodClient = await this.getOrCreateClient(secretId, secretKey, region);

    const modelConfig = resolveTencentKlingModel(request.model);
    if (!modelConfig) {
      throw new Error(`Unsupported Tencent model: ${request.model}`);
    }

    const { image, video, prompt, character_orientation, keep_original_sound } = request.input;

    if (!image || !video) {
      throw new Error('Both image and video are required for Tencent Kling motion control');
    }

    // 构建额外参数
    const keepSound = keep_original_sound !== false ? 'yes' : 'no';
    const orientation = character_orientation || 'video';

    const additionalParams = JSON.stringify({
      keep_original_sound: keepSound,
      character_orientation: orientation,
    });

    const requestParams: CreateAigcVideoTaskRequest = {
      SubAppId: subAppId,
      ModelName: 'Kling',
      ModelVersion: modelConfig.version,
      FileInfos: [
        { Type: 'Url', Category: 'Video', Url: video },
        { Type: 'Url', Category: 'Image', Url: image },
      ],
      Prompt: prompt || '参考视频生成一个新视频',
      OutputConfig: {
        StorageMode: 'Temporary',
        Resolution: modelConfig.resolution,
      },
      SceneType: 'motion_control',
      ExtInfo: JSON.stringify({ AdditionalParameters: additionalParams }),
    };

    this.logger.log(
      `Submit Tencent Kling: model=${request.model} version=${modelConfig.version} account=${accountId}`,
      JSON.stringify(requestParams),
    );

    try {
      const response: CreateAigcVideoTaskResponse = await vodClient.CreateAigcVideoTask(requestParams);

      if (!response?.TaskId) {
        const error = new Error('CreateAigcVideoTask returned no TaskId');
        ErrorLogger.logError(
          this.logger,
          error,
          { model: request.model, provider: this.providerName },
          'Tencent CreateAigcVideoTask returned no TaskId',
        );
        throw error;
      }

      this.logger.log(`Tencent task created: TaskId=${response.TaskId}`);

      // 上报成功结果到账号池
      this.accountPoolService
        .reportResult(accountId, this.providerName, { success: true, durationMs: 0 })
        .catch(() => {});

      return {
        providerTaskId: response.TaskId,
        isSync: false,
        rawResponse: response,
      };
    } catch (error: any) {
      // 上报失败结果到账号池
      const retryable =
        error?.code === 'RequestLimitExceeded' ||
        error?.code === 'InternalError' ||
        error?.message?.includes('timeout');
      this.accountPoolService
        .reportResult(accountId, this.providerName, {
          success: false,
          durationMs: 0,
          errorCode: error?.code || 'TENCENT_ERROR',
          retryable,
        })
        .catch(() => {});

      ErrorLogger.logError(
        this.logger,
        error,
        { model: request.model, provider: this.providerName },
        'Tencent submitTask error',
      );
      throw error;
    }
  }

  async queryTask(providerTaskId: string, _meta?: Record<string, any>): Promise<QueryResult> {
    // 从账号池获取凭证（密钥唯一来源：extra_credentials）
    const { secretId, secretKey, region, subAppId } = await this.resolveCredentials();
    const vodClient = await this.getOrCreateClient(secretId, secretKey, region);

    this.logger.log(`Query Tencent task: TaskId=${providerTaskId}`);

    try {
      const requestParams: DescribeTaskDetailRequest = {
        SubAppId: subAppId,
        TaskId: providerTaskId,
      };

      const response: DescribeTaskDetailResponse = await vodClient.DescribeTaskDetail(requestParams);

      this.logger.log(`Tencent task status raw:`, JSON.stringify(response));

      const taskStatus = response?.Status;
      const aigcTask = response?.AigcVideoTask;

      const result: QueryResult = {
        status: 'processing',
        progress: 0,
        result: null,
        error: undefined,
        rawResponse: response,
      };

      switch (taskStatus) {
        case 'WAITING':
          result.status = 'pending';
          break;

        case 'PROCESSING':
          result.status = 'processing';
          result.progress = 50; // 估算进度
          break;

        case 'FINISH': {
          const errCode = aigcTask?.ErrCode;
          if (errCode && errCode !== 0) {
            result.status = 'failed';
            result.error = {
              code: `TENCENT_${errCode}`,
              message: aigcTask?.Message || 'Tencent AIGC task failed',
            };
          } else {
            const fileInfos = aigcTask?.Output?.FileInfos || [];
            const outputs = fileInfos.map((f) => f.FileUrl).filter(Boolean);

            if (outputs.length === 0) {
              result.status = 'failed';
              result.error = {
                code: 'TENCENT_NO_OUTPUT',
                message: 'No output file URL in AIGC task result',
              };
            } else {
              result.status = 'succeeded';
              result.progress = 100;
              result.result = outputs.length === 1 ? outputs[0] : outputs;

              // 提取视频时长
              const duration = fileInfos[0]?.MetaData?.Duration;
              if (duration) {
                result.rawResponse = {
                  ...response,
                  duration,
                };
              }
            }
          }
          break;
        }

        default:
          result.status = 'processing';
          break;
      }

      this.logger.log(`Tencent task status normalized:`, JSON.stringify(result));
      return result;
    } catch (error: any) {
      ErrorLogger.logError(
        this.logger,
        error,
        { providerTaskId, provider: this.providerName },
        'Tencent queryTask error',
      );
      throw error;
    }
  }

  async cancelTask(_providerTaskId: string): Promise<CancelResult> {
    // 腾讯云 VOD AIGC 任务不支持取消
    return {
      accepted: false,
      message: 'Tencent Cloud VOD AIGC tasks do not support cancellation',
    };
  }

  mapStatus(providerStatus: string): TaskStatus {
    const map: Record<string, TaskStatus> = {
      WAITING: TaskStatus.SUBMITTED,
      PROCESSING: TaskStatus.PROCESSING,
      FINISH: TaskStatus.SUCCESS, // 需要进一步检查 ErrCode
    };
    return map[providerStatus] || TaskStatus.PROCESSING;
  }

  mapError(providerError: any) {
    const message = providerError?.message || providerError?.Message || 'Tencent Cloud error';
    const code = providerError?.code || providerError?.Code || 'TENCENT_ERROR';
    const requestId = providerError?.RequestId || '';

    let fullMessage = message;
    if (requestId) {
      fullMessage = `${message} [RequestId: ${requestId}]`;
    }

    // 判断是否可重试
    const retryable =
      code === 'RequestLimitExceeded' ||
      code === 'InternalError' ||
      message.includes('timeout') ||
      message.includes('network');

    return {
      code: `TENCENT_${code}`,
      message: fullMessage,
      retryable,
    };
  }

  getRateLimitConfig(): RateLimitConfig {
    return this.providerConfig.getSubmitLimitsSync(this.providerName);
  }
}
