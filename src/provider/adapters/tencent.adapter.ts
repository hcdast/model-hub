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
import { ErrorLogger } from '../../common/utils/error-logger.util';

// Tencent Cloud SDK types
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
const TencentKlingModelMap: Record<string, { version: string; mode: string; resolution: string }> = {
  'tencent-cloud/kling-v3.0-pro/motion-control': { version: '3.0', mode: 'pro', resolution: '1080p' },
  'tencent-cloud/kling-v3.0-std/motion-control': { version: '3.0', mode: 'std', resolution: '1080p' },
  'tencent-cloud/kling-v2.6-pro/motion-control': { version: '2.6', mode: 'pro', resolution: '1080p' },
  'tencent-cloud/kling-v2.6-std/motion-control': { version: '2.6', mode: 'std', resolution: '1080p' },
};

@Injectable()
export class TencentAdapter implements IProviderAdapter {
  readonly providerName = 'tencent-cloud';
  private readonly logger = new Logger(TencentAdapter.name);
  private readonly subAppId: number;
  private vodClient: any;
  private initPromise: Promise<void> | null = null;
  private initialized = false;

  constructor(
    private readonly providerConfig: ProviderConfigService,
  ) {
    // 从 ProviderConfigService 的 extra 字段读取腾讯云凭证
    const resolved = this.providerConfig.getResolvedSync(this.providerName);
    const extra = (resolved as any).extra || {};
    
    this.subAppId = Number(extra.subAppId) || 0;
    const secretId = String(extra.secretId || '');
    const secretKey = String(extra.secretKey || '');
    const region = String(extra.region || '');

    if (!secretId || !secretKey) {
      this.logger.warn('Tencent Cloud credentials not configured in provider runtime config');
    } else {
      // 启动异步初始化，但保存 Promise 以便等待
      this.initPromise = this.initializeClient(secretId, secretKey, region);
    }
  }

  private async initializeClient(secretId: string, secretKey: string, region: string): Promise<void> {
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

      this.vodClient = new VodClient(clientConfig);
      this.initialized = true;
      this.logger.log('Tencent Cloud VOD client initialized');
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

  /**
   * 确保客户端已初始化，如果正在初始化则等待
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    
    throw new Error('Tencent Cloud VOD client not initialized and no credentials configured');
  }

  async submitTask(request: NormalizedTaskRequest): Promise<SubmitResult> {
    await this.ensureInitialized();
    
    if (!this.vodClient) {
      throw new Error('Tencent Cloud VOD client not initialized');
    }

    const modelConfig = TencentKlingModelMap[request.model];
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
      SubAppId: this.subAppId,
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
      `Submit Tencent Kling: model=${request.model} version=${modelConfig.version}`,
      JSON.stringify(requestParams),
    );

    try {
      const response: CreateAigcVideoTaskResponse = await this.vodClient.CreateAigcVideoTask(requestParams);

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

      return {
        providerTaskId: response.TaskId,
        isSync: false,
        rawResponse: response,
      };
    } catch (error: any) {
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
    await this.ensureInitialized();
    
    if (!this.vodClient) {
      throw new Error('Tencent Cloud VOD client not initialized');
    }

    this.logger.log(`Query Tencent task: TaskId=${providerTaskId}`);

    try {
      const requestParams: DescribeTaskDetailRequest = {
        SubAppId: this.subAppId,
        TaskId: providerTaskId,
      };

      const response: DescribeTaskDetailResponse = await this.vodClient.DescribeTaskDetail(requestParams);

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
