import { expectedRevision, revisionMatch, validateConfigInput } from './utils/config-input';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import {
  ProviderRuntimeConfig,
  ProviderRuntimeConfigDocument,
} from '../database/schemas/provider-runtime-config.schema';
import { ProviderConfigService } from '../provider/provider-config.service';
import { REGISTERED_PROVIDER_NAMES } from '../queue/queue.constants';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { AuditLogService } from './audit-log.service';
import { ModelConfig, ModelConfigDocument } from '../database/schemas/model-config.schema';
import { AccountPoolEntry, AccountPoolEntryDocument } from '../database/schemas/account-pool-entry.schema';
import { ModelRoutingRule, ModelRoutingRuleDocument } from '../database/schemas/model-routing-rule.schema';
import { Task, TaskDocument } from '../database/schemas/task.schema';
import { TERMINAL_STATUSES } from '../common/constants/task-status';
import { AccountPoolService } from '../provider/account-pool/account-pool.service';

@ApiTags('管理后台 - 供应商运行时配置')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/provider-configs')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminProviderConfigController {
  constructor(
    @InjectModel(ProviderRuntimeConfig.name)
    private readonly runtimeModel: Model<ProviderRuntimeConfigDocument>,
    private readonly providerConfig: ProviderConfigService,
    private readonly auditLog: AuditLogService,
    @InjectModel(ModelConfig.name) private readonly modelConfigModel: Model<ModelConfigDocument>,
    @InjectModel(AccountPoolEntry.name) private readonly accountModel: Model<AccountPoolEntryDocument>,
    @InjectModel(ModelRoutingRule.name) private readonly routingModel: Model<ModelRoutingRuleDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    private readonly accountPool: AccountPoolService,
  ) {}

  @Get()
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '供应商运行时配置列表（MongoDB，不含密钥）' })
  @ApiResponse({ status: 200, description: '成功' })
  async list() {
    const rows = await this.runtimeModel
      .find({ provider_name: { $in: [...REGISTERED_PROVIDER_NAMES] } })
      .lean();
    const items = rows.map((row) => {
      const name = row.provider_name;
      const resolved = this.providerConfig.getResolvedSync(name);
      return {
        provider_name: name,
        enabled: row.enabled !== false,
        icon_url: row?.icon_url || '',
        base_url: resolved.baseUrl,
        limits: resolved.limits,
        poll_limits: {
          max_per_second: resolved.pollLimits.maxPerSecond ?? resolved.limits.maxPerSecond,
          max_concurrent: resolved.pollLimits.maxConcurrent,
        },
        revision: row?.revision ?? 0,
        updatedAt: (row as { updatedAt?: Date })?.updatedAt,
      };
    });

    return {
      code: 0,
      data: {
        items,
        available_providers: [...REGISTERED_PROVIDER_NAMES],
        notice: 'API 密钥已统一在「供应商账号池」管理，请在账号池页面查看和配置密钥。',
      },
    };
  }

  @Get(':providerName/readiness')
  @RequirePermissions('provider:read')
  async readiness(@Param('providerName') name: string) {
    if (!REGISTERED_PROVIDER_NAMES.includes(name as any)) throw new BadRequestException('Unknown provider_name');
    const [models, accounts, activeAccounts, routes, activeTasks] = await Promise.all([
      this.modelConfigModel.countDocuments({ provider: name }), this.accountModel.countDocuments({ provider_name: name }),
      this.accountModel.countDocuments({ provider_name: name, enabled: true }),
      this.routingModel.countDocuments({ $or: [{ fixed_provider: name }, { primary_provider: name }, { fallback_provider: name }, { 'weighted_targets.provider': name }, { latency_targets: name }, { 'cost_targets.provider': name }] }),
      this.taskModel.countDocuments({ provider: name, status: { $nin: [...TERMINAL_STATUSES] } }),
    ]);
    const resolved = this.providerConfig.getResolvedSync(name);
    return { code: 0, data: { provider: name, registered: true, enabled: resolved.enabled, hasBaseUrl: !!resolved.baseUrl, models, accounts, activeAccounts, routes, activeTasks,
      canDelete: !resolved.enabled && !models && !accounts && !routes && !activeTasks,
      warnings: [!resolved.enabled && '供应商已停用', !resolved.baseUrl && '缺少服务地址', !activeAccounts && '没有启用账号；请检查账号池或遗留凭证来源', !models && '没有关联模型'].filter(Boolean),
      checkedAt: new Date().toISOString(), scope: '仅本地配置与依赖检查，未向供应商发起生成或鉴权请求' } };
  }

  @Get(':providerName')
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '单供应商详情（不含密钥）' })
  async detail(@Param('providerName') providerName: string) {
    const name = decodeURIComponent(providerName);
    if (!REGISTERED_PROVIDER_NAMES.includes(name as any)) {
      return { code: 1001, message: 'Unknown provider_name' };
    }
    const row = await this.runtimeModel.findOne({ provider_name: name }).lean();
    if (!row) throw new NotFoundException('供应商配置不存在');
    const resolved = this.providerConfig.getResolvedSync(name);
    return {
      code: 0,
      data: {
        provider_name: name,
        enabled: row?.enabled ?? true,
        icon_url: row?.icon_url || '',
        base_url: resolved.baseUrl,
        extra: row?.extra || {},
        limits: resolved.limits,
        poll_limits: {
          max_per_second: resolved.pollLimits.maxPerSecond ?? resolved.limits.maxPerSecond,
          max_concurrent: resolved.pollLimits.maxConcurrent,
        },
        revision: row?.revision ?? 0,
        updatedAt: (row as { updatedAt?: Date })?.updatedAt,
        notice: 'API 密钥已统一在「供应商账号池」管理，请在账号池页面查看和配置密钥。',
      },
    };
  }

  @Put(':providerName')
  @RequirePermissions('provider:update')
  @ApiOperation({ summary: 'Upsert 供应商配置写入 Mongo（不含密钥，密钥请在账号池管理）' })
  async upsert(
    @Param('providerName') providerName: string,
    @Body()
    body: {
      expected_revision?: number;
      enabled?: boolean;
      base_url?: string;
      llm_base_url?: string;
      icon_url?: string;
      extra?: Record<string, unknown>;
      limits?: {
        max_concurrent?: number;
        max_per_second?: number;
        max_per_minute?: number;
      };
      poll_limits?: { max_per_second?: number; max_concurrent?: number };
    },
    @Req() req: Request,
  ) {
    const name = decodeURIComponent(providerName);
    if (!REGISTERED_PROVIDER_NAMES.includes(name as any)) {
      return { code: 1001, message: 'Unknown provider_name' };
    }

    validateConfigInput(body);
    const existing = await this.runtimeModel.findOne({ provider_name: name }).lean();
    expectedRevision(existing, body.expected_revision);
    const admin = (req as any).adminUser as { username?: string };
    const operator = admin?.username || 'unknown';

    const setDoc: Record<string, unknown> = {};
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      throw new BadRequestException('enabled 必须为布尔值');
    }
    if (body.enabled !== undefined) setDoc.enabled = body.enabled;
    if (body.base_url !== undefined) setDoc.base_url = String(body.base_url).trim();
    if (body.icon_url !== undefined) setDoc.icon_url = String(body.icon_url).trim();
    if (body.extra !== undefined) setDoc.extra = body.extra;
    if (body.llm_base_url !== undefined) {
      if (name !== 'akool-maas' || typeof body.llm_base_url !== 'string' || body.extra !== undefined) throw new BadRequestException('LLM 地址仅用于 akool-maas，不能与 extra 同时修改');
      const base = body.llm_base_url.trim();
      if (base) {
        try {
          const url = new URL(base);
          if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/\/v1\/?$/.test(url.pathname)) throw new Error();
        } catch { throw new BadRequestException('LLM Base URL 需要为以 /v1 结尾的 HTTPS 地址，不含凭证、查询参数或片段'); }
      }
      setDoc['extra.llm_base_url'] = base.replace(/\/+$/, '');
    }
    if (body.limits !== undefined) setDoc.limits = body.limits;
    if (body.poll_limits !== undefined) setDoc.poll_limits = body.poll_limits;

    // 已移除: api_key 参数 — 密钥统一在账号池管理

    let updated: any;
    try {
      updated = await this.runtimeModel.findOneAndUpdate(
        { provider_name: name, ...revisionMatch(existing) },
        { $set: setDoc, $inc: { revision: 1 } },
        { upsert: !existing, new: true },
      );
    } catch (error: any) { if (error.code === 11000) throw new ConflictException('配置已被修改，请刷新后重试'); throw error; }
    if (!updated) throw new ConflictException('配置已被修改，请刷新后重试');

    await this.providerConfig.invalidateAndRefresh();
    if (body.enabled !== undefined) await this.accountPool.refreshAllPools();

    await this.auditLog.log(
      'provider_runtime_config.upsert',
      operator,
      {
        provider_name: name,
        revision: updated.revision,
        keys: Object.keys(setDoc),
      },
      req.ip,
    );

    return { code: 0, data: { provider_name: name, revision: updated.revision } };
  }

  @Delete(':providerName')
  @RequirePermissions('provider:delete')
  @ApiOperation({ summary: '删除已停用且没有关联数据的供应商配置' })
  async remove(@Param('providerName') name: string, @Req() req: Request) {
    if (!REGISTERED_PROVIDER_NAMES.includes(name as any)) throw new BadRequestException('Unknown provider_name');
    const existing = await this.runtimeModel.findOne({ provider_name: name }).lean();
    if (!existing) throw new NotFoundException('供应商配置不存在');
    if (existing.enabled !== false) throw new ConflictException('请先停用供应商，再删除配置');

    const [models, accounts, routes, activeTasks] = await Promise.all([
      this.modelConfigModel.countDocuments({ provider: name }),
      this.accountModel.countDocuments({ provider_name: name }),
      this.routingModel.countDocuments({ $or: [
        { fixed_provider: name }, { primary_provider: name }, { fallback_provider: name },
        { 'weighted_targets.provider': name }, { latency_targets: name }, { 'cost_targets.provider': name },
      ] }),
      this.taskModel.countDocuments({ provider: name, status: { $nin: [...TERMINAL_STATUSES] } }),
    ]);
    if (models || accounts || routes || activeTasks) {
      throw new ConflictException(`无法删除：仍关联 ${models} 个模型、${accounts} 个账号、${routes} 条路由、${activeTasks} 个未结束任务，请先处理关联数据`);
    }
    const deleted = await this.runtimeModel.findOneAndDelete({
      _id: existing._id, enabled: false,
      revision: existing.revision ?? { $exists: false },
    });
    if (!deleted) throw new ConflictException('供应商配置已变更，请刷新后重试');
    await this.providerConfig.invalidateAndRefresh();
    await this.auditLog.log('provider_runtime_config.delete', (req as any).adminUser?.username || 'unknown', {
      provider_name: name, revision: existing.revision || 0,
    }, req.ip);
    return { code: 0, data: { deleted: true, provider_name: name } };
  }

  @Put(':providerName/cost-config')
  @RequirePermissions('provider:update')
  @ApiOperation({ summary: '更新供应商成本配置（用于 cost-based 路由策略）' })
  @ApiResponse({ status: 200, description: '成功' })
  async updateCostConfig(
    @Param('providerName') providerName: string,
    @Body()
    body: {
      cost_per_unit?: number;
      cost_unit?: string;
      expected_revision?: number;
    },
    @Req() req: Request,
  ) {
    const name = decodeURIComponent(providerName);
    if (!REGISTERED_PROVIDER_NAMES.includes(name as any)) {
      return { code: 1001, message: 'Unknown provider_name' };
    }

    const existing = await this.runtimeModel.findOne({ provider_name: name }).lean();
    if (!existing) throw new NotFoundException('供应商配置不存在');
    expectedRevision(existing, body.expected_revision);
    // 校验 cost_per_unit
    if (body.cost_per_unit !== undefined) {
      const cost = Number(body.cost_per_unit);
      if (typeof body.cost_per_unit !== 'number' || !Number.isFinite(cost) || cost < 0) {
        throw new BadRequestException('cost_per_unit must be a non-negative number');
      }
    }

    // 校验 cost_unit
    const validCostUnits = ['per_call', 'per_token', 'per_second'];
    if (body.cost_unit !== undefined) {
      if (!validCostUnits.includes(body.cost_unit)) {
        throw new BadRequestException(`cost_unit must be one of: ${validCostUnits.join(', ')}`);
      }
    }

    const costConfig: Record<string, unknown> = { ...existing.cost_config };
    if (body.cost_per_unit !== undefined) costConfig.cost_per_unit = Number(body.cost_per_unit);
    if (body.cost_unit !== undefined) costConfig.cost_unit = body.cost_unit;

    const updated = await this.runtimeModel.findOneAndUpdate(
      { _id: existing._id, ...revisionMatch(existing) },
      { $set: { cost_config: costConfig }, $inc: { revision: 1 } },
      { new: true },
    );
    if (!updated) throw new ConflictException('供应商配置已变化，请刷新后重试');

    await this.providerConfig.invalidateAndRefresh();

    const admin = (req as any).adminUser as { username?: string };
    const operator = admin?.username || 'unknown';

    await this.auditLog.log(
      'provider_runtime_config.update_cost_config',
      operator,
      {
        provider_name: name,
        cost_config: costConfig,
        revision: updated.revision,
      },
      req.ip,
    );

    return { code: 0, data: { provider_name: name, cost_config: costConfig, revision: updated.revision } };
  }
}
