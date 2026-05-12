import {
  Injectable, Logger, Inject, BadRequestException, NotFoundException, ConflictException,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { ulid } from 'ulid';
import { TaskRepository } from './task.repository';
import { IdempotencyService } from './idempotency.service';
import { TaskTimelineService, TimelineEvent } from './task-timeline.service';
import { TaskTimingService } from './task-timing.service';
import { ProviderRegistry } from '../provider/provider.registry';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskListQueryDto } from './dto/task-list-query.dto';
import { TaskStatus, CallbackStatus, CANCELLABLE_STATUSES } from '../common/constants/task-status';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { MetricsService } from '../observability/metrics.service';
import { QueueRouterService } from '../queue/queue-router.service';
import { TaskDocument, Task } from '../database/schemas/task.schema';
import { FilterQuery, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import {
  listKnownServiceKeys,
  mapModelConfigServiceToProvider,
} from './model-service-provider.map';
import { ProviderRoutingService } from './provider-routing.service';
import { ErrorLogger } from '../common/utils/error-logger.util';
import { ApiClientService } from '../api-client/api-client.service';
import { UsageTrackerService } from '../api-client/usage-tracker.service';
import { validateParams } from '../common/utils/param-validator';
import { transformParams } from '../common/utils/param-transformer';
import { ParamDefinitions } from '../common/interfaces/param-definition.interface';
import { roundMoney } from '../common/utils/money.util';
import { BillingAdapter } from '../billing/billing.adapter';
import { BillingService } from '../billing/billing.service';
import { InsufficientBalanceException } from '../billing/exceptions/insufficient-balance.exception';
import { TaskResourceMetadataEnqueueService } from '../queue/task-resource-metadata-enqueue.service';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly idempotencyService: IdempotencyService,
    private readonly timelineService: TaskTimelineService,
    private readonly timingService: TaskTimingService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly providerRouting: ProviderRoutingService,
    private readonly metrics: MetricsService,
    private readonly queueRouter: QueueRouterService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectModel(ModelConfig.name)
    private readonly modelConfigModel: Model<ModelConfigDocument>,
    private readonly apiClientService: ApiClientService,
    private readonly usageTracker: UsageTrackerService,
    private readonly billingAdapter: BillingAdapter,
    private readonly billingService: BillingService,
    private readonly resourceMetadataEnqueue: TaskResourceMetadataEnqueueService,
  ) {}

  async createTask(clientId: string, dto: CreateTaskDto, idempotencyKey?: string) {
    const receivedAt = new Date();

    if (idempotencyKey) {
      const existingTaskId = await this.idempotencyService.check(clientId, idempotencyKey);
      if (existingTaskId) {
        const existing = await this.taskRepo.findByTaskId(existingTaskId);
        if (existing) {
          this.logger.log(`Idempotent request: clientId=${clientId}, key=${idempotencyKey}, taskId=${existingTaskId}`);
          return this.toResponse(existing);
        }
      }
    }

    let provider: string;
    let featureType: string;
    let routeId: string | undefined;
    let routingSource: 'routing_rule' | 'model_config_service' | 'model_path';
    let providerModel: string | undefined; // 实际发送给提供商的模型标识
    let routingMetrics: Record<string, any> | undefined; // latency/cost 策略的路由决策指标

    // 先计算 featureType，用于后续查询 model_configs
    featureType = this.resolveTaskFeatureType(dto.model, dto.options);
    const modelType = this.featureTypeToModelType(featureType);

    // 查询 model_configs 时同时匹配 model_name 和 model_type
    const cfg = await this.modelConfigModel.findOne({ 
      model_name: dto.model,
      ...(modelType ? { model_type: modelType } : {})
    }).lean();
    
    if (cfg?.disabled) {
      ErrorLogger.logWarning(
        this.logger,
        'Model is disabled',
        { clientId, model: dto.model, modelType },
      );
      throw new BadRequestException(`Model is disabled: ${dto.model}`);
    }

    // 如果配置中有 provider_model_name，使用它作为发送给提供商的模型标识
    if (cfg?.provider_model_name) {
      providerModel = cfg.provider_model_name;
      this.logger.log(`Using provider_model_name: ${providerModel} for model: ${dto.model}, type: ${modelType}`);
    }

    const ruleHit = await this.providerRouting.tryResolveFromRules(dto.model, clientId);
    if (ruleHit) {
      provider = ruleHit.provider;
      routeId = ruleHit.routeId || undefined;
      routingSource = 'routing_rule';
      routingMetrics = ruleHit.routingMetrics;
      this.logger.log(
        `Provider from model_routing_rules routeId=${routeId} → ${provider}, model=${dto.model}`,
      );
    } else {
      const svcRaw = cfg?.service != null ? String(cfg.service).trim() : '';
      if (cfg && svcRaw !== '') {
        const mapped = mapModelConfigServiceToProvider(cfg.service);
        if (!mapped) {
          ErrorLogger.logWarning(
            this.logger,
            `No Model-Hub adapter for model_configs.service="${svcRaw}"`,
            { clientId, model: dto.model, service: svcRaw },
          );
          throw new BadRequestException(
            `No Model-Hub adapter for model_configs.service="${svcRaw}" (model: ${dto.model}). `
            + `Supported service: ${listKnownServiceKeys().join(', ')}`,
          );
        }
        provider = mapped;
        routingSource = 'model_config_service';
        this.logger.log(`Provider from model_configs.service=${svcRaw} → ${provider}, model=${dto.model}`);
      } else {
        const fb = this.resolveProviderFromModel(dto.model);
        provider = fb.provider;
        routingSource = 'model_path';
      }
    }

    if (!this.providerRegistry.hasAdapter(provider)) {
      ErrorLogger.logWarning(
        this.logger,
        'Unsupported provider',
        { clientId, model: dto.model, provider },
      );
      throw new BadRequestException(`Unsupported provider: ${provider}`);
    }

    // 参数校验与转换：根据 ModelConfig.params 定义校验请求参数并转换第三方字段名
    if (cfg?.params && Object.keys(cfg.params).length > 0) {
      const definitions = cfg.params as ParamDefinitions;

      // 归一化 image/images：根据 config 期望的字段转换客户端输入
      this.normalizeImageFields(dto.input, definitions);

      const validationResult = validateParams(dto.input, definitions);
      if (!validationResult.valid) {
        throw new BadRequestException({
          message: '参数校验失败',
          errors: validationResult.errors,
        });
      }
      // 用校验后的参数（含默认值、过滤未定义字段）替换原始 input
      dto.input = validationResult.sanitized;

      // 转换第三方字段名
      const { transformed } = transformParams(dto.input, definitions);
      dto.input = transformed;
    }

    // 三方资源转存仅在任务成功后的 resultPayload 上执行（见 resource-metadata 队列），
    // 创建任务时保留客户端传入的 input URL，由上游/供应商拉取。
    const taskId = ulid();
    const pollingCfg = this.config.polling;

    // 优先级解析：显式指定 > ApiClient defaultPriority > 50
    const resolvedPriority = await this.resolvePriority(dto.priority, clientId);

    // === 计费初始化：在任务入库之前调用，确保余额充足 ===
    try {
      await this.billingAdapter.initBilling({
        taskId,
        clientId,
        model: dto.model,
        provider,
        featureType,
        input: dto.input,
        options: dto.options,
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceException) {
        // 余额不足 → 返回 HTTP 402 + INSUFFICIENT_BALANCE 错误码
        throw new HttpException(
          {
            success: false,
            code: InsufficientBalanceException.ERROR_CODE,
            message: err.message,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      // 其他计费异常 → 记录 error 日志 + 返回 500
      this.logger.error(
        `计费初始化失败：taskId=${taskId}, clientId=${clientId}, model=${dto.model}`,
        err instanceof Error ? err.stack : err,
      );
      throw new HttpException(
        {
          success: false,
          code: 'BILLING_INIT_FAILED',
          message: 'Billing initialization failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 计费成功后才入库入队
    const task = await this.taskRepo.create({
      taskId, clientId, model: dto.model, provider, featureType,
      providerModel, // 保存 provider_model_name
      routeId,
      status: TaskStatus.PENDING, version: 0,
      requestPayload: { input: dto.input, options: dto.options },
      callback: dto.callbackUrl ? {
        url: dto.callbackUrl,
        secret: dto.callbackSecret || this.config.callback.defaultSecret,
        status: CallbackStatus.PENDING, retryCount: 0,
      } : undefined,
      polling: {
        pollCount: 0, pollInterval: pollingCfg.defaultIntervalMs,
        maxPollCount: pollingCfg.maxPollCount, maxDuration: pollingCfg.maxDurationMs,
      },
      priority: resolvedPriority, 
      metadata: { 
        ...dto.metadata,
        routingSource, // 保存路由来源用于审计
      },
    });

    await this.timingService.recordTiming(taskId, 'receivedAt', receivedAt);
    await this.timelineService.addEvent(taskId, TimelineEvent.TASK_CREATED, {
      model: dto.model, provider, featureType, routingSource, routeId,
      ...(routingMetrics ? { routingMetrics } : {}),
    });

    if (idempotencyKey) {
      await this.idempotencyService.record(clientId, idempotencyKey, taskId);
    }

    const enqueuedAt = new Date();
    const jobData = {
      taskId, provider, model: dto.model, featureType,
      priority: resolvedPriority, clientId, enqueuedAt: enqueuedAt.getTime(),
    };
    const jobId = await this.queueRouter.enqueue(
      featureType, provider, 'submit', jobData, { priority: resolvedPriority },
    );

    this.metrics.taskCreatedTotal.inc({ feature_type: featureType, provider, model: dto.model });

    await this.timingService.recordTiming(taskId, 'enqueuedAt', enqueuedAt);
    const queueName = this.queueRouter.resolveQueueName(featureType, provider);
    await this.timelineService.addEvent(taskId, TimelineEvent.TASK_ENQUEUED, { queueName, jobId });

    this.logger.log(`Task created: taskId=${taskId}, model=${dto.model}, provider=${provider}`);

    // 异步记录 Usage，不阻塞任务创建
    this.usageTracker.recordRequest(clientId).catch((err) => {
      this.logger.warn(`Usage 记录请求失败: clientId=${clientId}, error=${(err as Error).message}`);
    });

    return this.toResponse(task);
  }

  async getTask(clientId: string, taskId: string) {
    const task = await this.taskRepo.findByClientAndTaskId(clientId, taskId);
    if (!task) {
      ErrorLogger.logWarning(
        this.logger,
        'Task not found',
        { clientId, taskId },
      );
      throw new NotFoundException(`Task not found: ${taskId}`);
    }

    // 查询计费记录
    const billingRecord = await this.billingService.getRecord(taskId);

    return this.toResponse(task, billingRecord);
  }

  async listTasks(clientId: string, query: TaskListQueryDto) {
    const filter: FilterQuery<Task> = {};
    if (query.status) filter.status = query.status;
    if (query.model) filter.model = query.model;
    if (query.provider) filter.provider = query.provider;
    if (query.featureType) filter.featureType = query.featureType;

    const { items, total } = await this.taskRepo.listByClient(clientId, filter, query.page ?? 1, query.pageSize ?? 20);
    return { items: items.map((t) => this.toResponse(t)), total, page: query.page ?? 1, pageSize: query.pageSize ?? 20 };
  }

  async cancelTask(clientId: string, taskId: string, cancelledBy?: string) {
    const task = await this.taskRepo.findByClientAndTaskId(clientId, taskId);
    if (!task) {
      ErrorLogger.logWarning(
        this.logger,
        'Task not found for cancellation',
        { clientId, taskId },
      );
      throw new NotFoundException(`Task not found: ${taskId}`);
    }
    if (!CANCELLABLE_STATUSES.has(task.status)) {
      ErrorLogger.logWarning(
        this.logger,
        'Task cannot be cancelled in current status',
        { clientId, taskId, status: task.status },
      );
      throw new ConflictException(`Task ${taskId} cannot be cancelled in status ${task.status}`);
    }
    const updated = await this.taskRepo.updateStatus(taskId, [TaskStatus.PENDING, TaskStatus.SUBMITTED], TaskStatus.CANCELLED);
    if (!updated) {
      ErrorLogger.logWarning(
        this.logger,
        'Task status changed concurrently during cancellation',
        { clientId, taskId },
      );
      throw new ConflictException('Task status changed concurrently');
    }

    // Best-effort: remove job from Bull queue
    try {
      await this.queueRouter.removeJob(task.featureType, task.provider, taskId);
    } catch (err: any) {
      this.logger.warn(`Failed to remove Bull job for cancelled task ${taskId}: ${err.message}`);
    }

    await this.timelineService.addEvent(taskId, TimelineEvent.TASK_CANCELLED, {
      cancelledBy: cancelledBy || clientId,
    });

    void this.resourceMetadataEnqueue.scheduleForTask(taskId).catch(() => undefined);

    this.logger.log(`Task cancelled: taskId=${taskId}, clientId=${clientId}, cancelledBy=${cancelledBy || clientId}`);
    return this.toResponse(updated);
  }

  /**
   * 动态调整 PENDING 任务的优先级
   */
  async updatePriority(
    taskId: string,
    newPriority: number,
    adminUsername: string,
  ): Promise<{ taskId: string; oldPriority: number; newPriority: number }> {
    if (newPriority < 0 || newPriority > 100 || !Number.isInteger(newPriority)) {
      throw new BadRequestException('priority must be an integer between 0 and 100');
    }

    const task = await this.taskRepo.findByTaskId(taskId);
    if (!task) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }
    if (task.status !== TaskStatus.PENDING) {
      throw new ConflictException(
        `Task ${taskId} cannot update priority in status ${task.status}, only PENDING is allowed`,
      );
    }

    const oldPriority = task.priority;

    // Update priority in DB
    await this.taskRepo.updatePriority(taskId, newPriority);

    // Remove old job from Bull queue and re-enqueue with new priority (best-effort)
    try {
      await this.queueRouter.removeJob(task.featureType, task.provider, taskId);
      const jobData = {
        taskId,
        provider: task.provider,
        model: task.model,
        featureType: task.featureType,
        priority: newPriority,
        clientId: task.clientId,
        enqueuedAt: Date.now(),
      };
      await this.queueRouter.reEnqueueWithPriority(
        task.featureType,
        task.provider,
        jobData,
        newPriority,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to re-enqueue task ${taskId} with new priority: ${err.message}`,
      );
    }

    // Record timeline event
    await this.timelineService.addEvent(taskId, TimelineEvent.PRIORITY_CHANGED, {
      oldPriority,
      newPriority,
      changedBy: adminUsername,
    });

    this.logger.log(
      `Priority updated: taskId=${taskId}, ${oldPriority} → ${newPriority}, by ${adminUsername}`,
    );

    return { taskId, oldPriority, newPriority };
  }

  /**
   * 归一化 image/images：根据 model config 期望的字段转换客户端输入。
   * config 期望 image(string) 但客户端传了 images(array) → 取 images[0] 作为 image
   * config 期望 images(array) 但客户端传了 image(string) → 包装为 [image] 作为 images
   */
  private normalizeImageFields(input: Record<string, any>, definitions: ParamDefinitions): void {
    const expectsImage = 'image' in definitions && definitions.image.type === 'string';
    const expectsImages = 'images' in definitions && definitions.images.type === 'array';

    const hasImage = input.image != null;
    const hasImages = Array.isArray(input.images) && input.images.length > 0;

    if (expectsImage && !expectsImages && !hasImage && hasImages) {
      // config 要 image，客户端传了 images → 取第一张
      input.image = input.images[0];
    } else if (expectsImages && !expectsImage && !hasImages && hasImage) {
      // config 要 images，客户端传了 image → 包装为数组
      input.images = [input.image];
    }
  }

  /**
   * 优先级解析：显式指定 > ApiClient defaultPriority > 50
   */
  private async resolvePriority(explicitPriority: number | undefined, clientId: string): Promise<number> {
    if (explicitPriority != null) return explicitPriority;
    try {
      return await this.apiClientService.getDefaultPriority(clientId);
    } catch {
      return 50;
    }
  }

  /**
   * 将 featureType 映射到 model_type，用于查询 model_configs
   */
  private featureTypeToModelType(featureType: string): number | null {
    const map: Record<string, number> = {
      'image_generate': 40001,      // 文生图
      'textToImage': 40001,
      'image_to_image': 40002,      // 图生图
      'imageToImage': 40002,
      'text_to_video': 1502,        // 文生视频
      'textToVideo': 1502,
      'image_to_video': 1501,       // 图生视频
      'imageToVideo': 1501,
      'character_swap': 40004,      // 角色换装/动作控制
      'characterFaceswap': 40004,
      'video_upscale': 40005,       // 视频超分
      'videoUpscale': 40005,
    };
    return map[featureType] || null;
  }

  /**
   * 功能类型：优先 options.featureType（与 Adapter 一致），否则按路径末段推断。
   */
  private resolveTaskFeatureType(model: string, options?: Record<string, any>): string {
    const opt = options?.featureType;
    if (typeof opt === 'string' && opt.length > 0) {
      const camelToInternal: Record<string, string> = {
        textToImage: 'image_generate',
        imageToImage: 'image_to_image',
        textToVideo: 'text_to_video',
        imageToVideo: 'image_to_video',
        videoToVideo: 'image_to_video',
        characterFaceswap: 'character_swap',
        videoUpscale: 'video_upscale',
      };
      if (camelToInternal[opt]) return camelToInternal[opt];
      if (/^(image_generate|image_to_image|text_to_video|image_to_video|character_swap|video_upscale|unknown)$/.test(opt)) {
        return opt;
      }
    }
    const parts = model.split('/');
    const last = parts.length >= 1 ? parts[parts.length - 1] : model;
    return this.inferFeatureType(last);
  }

  /** 无 model_configs / 无 service 时的兜底：路径首段当作 provider（兼容旧调用） */
  private resolveProviderFromModel(model: string) {
    const parts = model.split('/');
    if (parts.length < 2) throw new BadRequestException(`Invalid model format: ${model}`);
    const provider = parts[0];
    const featureType = this.inferFeatureType(parts[parts.length - 1]);
    return { provider, featureType };
  }

  private inferFeatureType(lastSegment: string): string {
    const map: Record<string, string> = {
      'text-to-image': 'image_generate',
      'image-to-image': 'image_to_image',
      edit: 'image_to_image',
      'edit-sequential': 'image_to_image',
      'text-to-video': 'text_to_video',
      'image-to-video': 'image_to_video',
      'reference-to-video': 'image_to_video',
      'video-to-video': 'image_to_video',
      'video-edit': 'image_to_video',
      'video-edit-fast': 'image_to_video',
      'motion-control': 'character_swap',
      animate: 'character_swap',
      'video-upscale': 'video_upscale',
    };
    return map[lastSegment] || 'unknown';
  }

  private toResponse(task: TaskDocument, billingRecord?: any) {
    const response: Record<string, any> = {
      taskId: task.taskId,
      clientId: task.clientId,
      status: task.status,
      model: task.model,
      provider: task.provider,
      providerModel: task.providerModel,
      featureType: task.featureType,
      routeId: task.routeId,
      routingSource: task.metadata?.routingSource,
      result: task.resultPayload || undefined,
      error: task.error || undefined,
      createdAt: (task as any).createdAt,
      updatedAt: (task as any).updatedAt,
    };

    // 添加计费信息
    if (billingRecord) {
      response.billing = {
        status: billingRecord.status,
        billingPolicy: billingRecord.billingPolicy,
        usageType: billingRecord.usageType,
        estimatedUsage: billingRecord.estimatedUsage,
        estimatedCost:
          typeof billingRecord.estimatedCost === 'number'
            ? roundMoney(billingRecord.estimatedCost)
            : billingRecord.estimatedCost,
        actualUsage: billingRecord.actualUsage,
        actualCost:
          typeof billingRecord.actualCost === 'number'
            ? roundMoney(billingRecord.actualCost)
            : billingRecord.actualCost,
        unitPrice:
          typeof billingRecord.unitPrice === 'number'
            ? roundMoney(billingRecord.unitPrice)
            : billingRecord.unitPrice,
        currency: billingRecord.currency,
        settledAt: billingRecord.settledAt,
        refundedAt: billingRecord.refundedAt,
        failReason: billingRecord.failReason,
      };
    }

    return response;
  }
}
