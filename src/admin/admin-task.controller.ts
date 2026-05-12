import { Controller, Get, Post, Put, Param, Query, Body, UseGuards, Req, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bull';
import { Model } from 'mongoose';
import { Queue } from 'bull';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import { ApiClient, ApiClientDocument } from '../database/schemas/api-client.schema';
import { BillingRecord, BillingRecordDocument } from '../database/schemas/billing-record.schema';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { AuditLogService } from './audit-log.service';
import { TaskTimelineService } from '../task/task-timeline.service';
import { TaskTimingService } from '../task/task-timing.service';
import { TaskService } from '../task/task.service';
import { TaskResourceMetadataEnqueueService } from '../queue/task-resource-metadata-enqueue.service';
import { TERMINAL_STATUSES } from '../common/constants/task-status';
import { Request } from 'express';
import { resolveUnitPriceMapTier, pickCreditReferenceUnitFromPriceMap } from '../billing/unit-price-map.util';
import { roundMoney } from '../common/utils/money.util';

@ApiTags('管理后台 - 任务管理')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/tasks')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminTaskController {
  private readonly logger = new Logger(AdminTaskController.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(ApiClient.name) private readonly apiClientModel: Model<ApiClientDocument>,
    @InjectModel(BillingRecord.name) private readonly billingModel: Model<BillingRecordDocument>,
    @InjectModel(ModelConfig.name) private readonly modelConfigModel: Model<ModelConfigDocument>,
    @InjectQueue('callback') private readonly callbackQueue: Queue,
    private readonly auditLogService: AuditLogService,
    private readonly timelineService: TaskTimelineService,
    private readonly timingService: TaskTimingService,
    private readonly taskService: TaskService,
    private readonly resourceMetadataEnqueue: TaskResourceMetadataEnqueueService,
  ) {}

  @Get()
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '任务列表（管理端）', description: '支持按状态、厂商、功能类型、模型筛选' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'featureType', required: false })
  @ApiQuery({ name: 'model', required: false })
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'pageSize', required: false, example: '20' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listTasks(
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('featureType') featureType?: string,
    @Query('model') model?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const query: any = {};
    if (status) query.status = status;
    if (provider) query.provider = provider;
    if (featureType) query.featureType = featureType;
    if (model) query.model = model;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const [rawItems, total] = await Promise.all([
      this.taskModel.find(query).sort({ createdAt: -1 }).skip((p - 1) * ps).limit(ps).lean(),
      this.taskModel.countDocuments(query),
    ]);

    const items = await this.attachClientDisplayNames(rawItems);

    return { code: 0, data: { items, total, page: p, pageSize: ps } };
  }

  @Get(':taskId')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '任务详情（管理端）' })
  @ApiQuery({
    name: 'refreshResourceMetadata',
    required: false,
    description: '传 1 时强制重新入队拉取资源元数据（异步）',
  })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getTask(
    @Param('taskId') taskId: string,
    @Query('refreshResourceMetadata') refreshResourceMetadata?: string,
  ) {
    const task = await this.taskModel.findOne({ taskId }).lean();
    if (!task) return { code: 3001, message: 'Task not found' };

    // 查询计费记录
    const billingRecord = await this.billingModel.findOne({ taskId }).lean();

    const [enriched] = await this.attachClientDisplayNames([task]);

    // 附加计费信息
    const data: Record<string, any> = { ...enriched };
    if (billingRecord) {
      const billing: Record<string, unknown> = {
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

      const actualRev =
        typeof billingRecord.actualCost === 'number'
          ? roundMoney(billingRecord.actualCost)
          : billingRecord.actualCost;
      const usageVal = billingRecord.actualUsage;
      billing.actualRevenue = actualRev;

      const pricingTierKey = this.extractPricingTierKey(task as Record<string, unknown>);
      billing.pricingTierKey = pricingTierKey ?? null;

      let cfg: Record<string, unknown> | null = null;
      if (task.model) {
        cfg = await this.resolveModelConfigRow(String(task.model), task.provider ? String(task.provider) : undefined);
      }

      let providerReferenceCost: number | undefined;
      if (cfg && typeof usageVal === 'number' && !Number.isNaN(usageVal)) {
        const unit = pickCreditReferenceUnitFromPriceMap(
          cfg.unit_price_map as Record<string, unknown> | undefined,
          pricingTierKey,
        );
        if (unit > 0) providerReferenceCost = roundMoney(unit * usageVal, 2);
      }
      if (providerReferenceCost !== undefined) {
        billing.providerReferenceCost = providerReferenceCost;
      }

      const usdResolved = cfg ? this.resolveUsdPricingFromCfg(cfg, pricingTierKey) : {};
      billing.unitPriceTierUsed = usdResolved.unitPriceTierUsed ?? null;
      const { costUnitUsd, saleUsdPerCredit } = usdResolved;

      let actualRevenueUsd: number | undefined;
      if (
        saleUsdPerCredit != null &&
        typeof actualRev === 'number' &&
        !Number.isNaN(actualRev)
      ) {
        actualRevenueUsd = roundMoney(actualRev * saleUsdPerCredit, 2);
      }

      let providerCostUsd: number | undefined;
      if (costUnitUsd != null && typeof usageVal === 'number' && !Number.isNaN(usageVal)) {
        providerCostUsd = roundMoney(costUnitUsd * usageVal, 2);
      }

      if (actualRevenueUsd !== undefined) billing.actualRevenueUsd = actualRevenueUsd;
      if (providerCostUsd !== undefined) billing.providerCostUsd = providerCostUsd;

      if (actualRevenueUsd !== undefined && providerCostUsd !== undefined) {
        const gpUsd = roundMoney(actualRevenueUsd - providerCostUsd, 2);
        billing.grossProfitUsd = gpUsd;
        if (actualRevenueUsd > 0) {
          billing.profitMarginPercent = roundMoney((gpUsd / actualRevenueUsd) * 100, 2);
        }
      }

      if (providerReferenceCost !== undefined && typeof actualRev === 'number' && !Number.isNaN(actualRev)) {
        billing.grossProfit = roundMoney(actualRev - providerReferenceCost, 2);
      }

      data.billing = billing;
    }

    const t = data as Record<string, any>;
    const terminal = TERMINAL_STATUSES.has(t.status);

    if (String(refreshResourceMetadata || '') === '1' && terminal) {
      await this.resourceMetadataEnqueue.scheduleForTask(taskId, { force: true });
      const latest = await this.taskModel.findOne({ taskId }).lean();
      if (latest) {
        const [re] = await this.attachClientDisplayNames([latest]);
        Object.assign(t, re);
      }
    }

    const extraction: Record<string, any> = {
      extractedAt: t.resourceMetadataAt,
      fingerprint: t.resourceMetadataFingerprint,
      error: t.resourceMetadataError,
    };
    const st = t.resourceMetadataStatus as string | undefined;

    if (!terminal) {
      extraction.status = 'not_applicable';
      data.resourceMetadataExtraction = extraction;
    } else if (st === 'ready' && t.resourceMetadata) {
      extraction.status = 'ready';
      data.resourceMetadata = t.resourceMetadata;
      data.resourceMetadataExtraction = extraction;
    } else if (st === 'skipped') {
      extraction.status = 'skipped';
      data.resourceMetadata = { input: {}, output: {} };
      data.resourceMetadataExtraction = extraction;
    } else if (st === 'failed') {
      extraction.status = 'failed';
      data.resourceMetadata = t.resourceMetadata;
      data.resourceMetadataExtraction = extraction;
    } else if (st === 'pending') {
      extraction.status = 'pending';
      data.resourceMetadata = t.resourceMetadata;
      data.resourceMetadataExtraction = extraction;
    } else {
      void this.resourceMetadataEnqueue.scheduleForTask(taskId).catch(() => undefined);
      extraction.status = 'queued';
      data.resourceMetadataExtraction = extraction;
    }

    return { code: 0, data };
  }

  @Get(':taskId/timeline')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '任务时间线', description: '获取任务完整的生命周期事件时间线' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getTimeline(@Param('taskId') taskId: string) {
    const timeline = await this.timelineService.getTimeline(taskId);
    return { code: 0, data: { taskId, timeline } };
  }

  @Get(':taskId/timing')
  @RequirePermissions('task:read')
  @ApiOperation({ summary: '任务时长指标', description: '获取任务各阶段精确时间点和计算时长' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getTiming(@Param('taskId') taskId: string) {
    const timing = await this.timingService.getTiming(taskId);
    return { code: 0, data: { taskId, timing } };
  }

  @Post(':taskId/replay-callback')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: '回调重放', description: '重新发送指定任务的回调' })
  @ApiResponse({ status: 200, description: '已入队' })
  async replayCallback(@Param('taskId') taskId: string, @Req() req: Request) {
    const task = await this.taskModel.findOne({ taskId }).lean();
    if (!task) return { code: 3001, message: 'Task not found' };
    if (!task.callback?.url) return { code: 1001, message: 'No callback URL configured' };

    await this.callbackQueue.add('deliver', { taskId, callbackUrl: task.callback.url, callbackSecret: task.callback.secret });
    const adminUser = (req as any).adminUser;
    await this.auditLogService.log('REPLAY_CALLBACK', adminUser?.username || 'unknown', { taskId });
    return { code: 0, message: 'Callback replay enqueued' };
  }

  @Post(':taskId/cancel')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: '管理员取消任务', description: '取消 PENDING 或 SUBMITTED 状态的任务' })
  @ApiResponse({ status: 200, description: '取消成功' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  @ApiResponse({ status: 409, description: '当前状态不允许取消' })
  async adminCancelTask(@Param('taskId') taskId: string, @Req() req: Request) {
    const task = await this.taskModel.findOne({ taskId }).lean();
    if (!task) return { code: 3001, message: 'Task not found' };
    const adminUser = (req as any).adminUser;
    const adminUsername = adminUser?.username || 'unknown';
    const data = await this.taskService.cancelTask(task.clientId, taskId, adminUsername);
    await this.auditLogService.log('CANCEL_TASK', adminUsername, { taskId, previousStatus: task.status });
    return { code: 0, data };
  }

  @Put(':taskId/priority')
  @RequirePermissions('task:update')
  @ApiOperation({ summary: '调整任务优先级', description: '动态调整 PENDING 状态任务的优先级' })
  @ApiResponse({ status: 200, description: '调整成功' })
  @ApiResponse({ status: 409, description: '任务状态不允许调整优先级' })
  async updatePriority(
    @Param('taskId') taskId: string,
    @Body() body: { priority: number },
    @Req() req: Request,
  ) {
    const adminUser = (req as any).adminUser;
    const adminUsername = adminUser?.username || 'unknown';
    const result = await this.taskService.updatePriority(taskId, body.priority, adminUsername);
    await this.auditLogService.log('UPDATE_TASK_PRIORITY', adminUsername, {
      taskId,
      oldPriority: result.oldPriority,
      newPriority: result.newPriority,
    });
    return { code: 0, data: result };
  }

  /** 按 model_name + provider 解析模型配置；无精确命中时回退为仅 model_name（与定价服务一致） */
  private async resolveModelConfigRow(
    modelName: string,
    provider?: string,
  ): Promise<Record<string, unknown> | null> {
    if (provider) {
      const exact = await this.modelConfigModel
        .findOne({
          model_name: modelName,
          provider,
          disabled: { $ne: true },
        })
        .select('unit_price_map')
        .lean();
      if (exact) return exact as Record<string, unknown>;
    }
    const fallback = await this.modelConfigModel
      .findOne({ model_name: modelName, disabled: { $ne: true } })
      .select('unit_price_map')
      .lean();
    return fallback ? (fallback as Record<string, unknown>) : null;
  }

  /** 从任务请求解析 unit_price_map 档位键（分辨率等），如 input.resolution / input.size */
  private extractPricingTierKey(task: Record<string, unknown>): string | undefined {
    const payload = task.requestPayload as Record<string, unknown> | undefined;
    const input = payload?.input as Record<string, unknown> | undefined;
    if (!input || typeof input !== 'object') return undefined;
    const r = input.resolution ?? input.size;
    if (typeof r === 'string' && r.trim()) return r.trim();
    if (typeof r === 'number' && Number.isFinite(r)) return String(r);
    return undefined;
  }

  /**
   * 解析 USD：仅从 unit_price_map 命中档位（及 default）内的 cost_unit_price / sale_unit_price。
   * cost 允许为 0；sale 须为正数才有 saleUsdPerCredit。
   */
  private resolveUsdPricingFromCfg(
    cfg: Record<string, unknown>,
    tierKey?: string,
  ): {
    costUnitUsd?: number;
    saleUsdPerCredit?: number;
    unitPriceTierUsed?: string;
  } {
    const upm = cfg.unit_price_map as Record<string, unknown> | undefined;
    const { entry, usedKey } = resolveUnitPriceMapTier(upm, tierKey);

    const costUnitUsd = entry ? this.pickUsdPerUsageCost(entry.cost_unit_price) : undefined;
    const saleUsdPerCredit = entry ? this.pickPositiveScalar(entry.sale_unit_price) : undefined;

    return {
      costUnitUsd,
      saleUsdPerCredit,
      unitPriceTierUsed: usedKey,
    };
  }

  private pickPositiveScalar(value: unknown): number | undefined {
    if (typeof value === 'number' && value > 0 && Number.isFinite(value)) return value;
    return undefined;
  }

  private pickUsdPerUsageCost(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    return undefined;
  }

  /** 为任务列表/详情附加 api_clients.name，便于后台区分调用方 */
  private async attachClientDisplayNames<T extends { clientId?: string }>(items: T[]): Promise<Array<T & { clientName: string | null }>> {
    const ids = [...new Set(items.map((t) => t.clientId).filter((id): id is string => Boolean(id)))];
    const nameByClientId = new Map<string, string | null>();
    if (ids.length > 0) {
      const clients = await this.apiClientModel
        .find({ clientId: { $in: ids } })
        .select('clientId name')
        .lean();
      for (const c of clients) {
        nameByClientId.set(c.clientId, c.name?.trim() ? c.name.trim() : null);
      }
    }
    return items.map((t) => {
      if (!t.clientId) return { ...t, clientName: null };
      const hit = nameByClientId.has(t.clientId);
      const clientName = hit ? (nameByClientId.get(t.clientId) ?? null) : null;
      return { ...t, clientName };
    });
  }
}
