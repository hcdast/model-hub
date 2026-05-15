import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
  BadRequestException,
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
  ) {}

  @Get()
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '供应商运行时配置列表（MongoDB，不含密钥）' })
  @ApiResponse({ status: 200, description: '成功' })
  async list() {
    const rows = await this.runtimeModel
      .find({ provider_name: { $in: [...REGISTERED_PROVIDER_NAMES] } })
      .lean();
    const byName = new Map(rows.map((r) => [r.provider_name, r]));

    const items = REGISTERED_PROVIDER_NAMES.map((name) => {
      const resolved = this.providerConfig.getResolvedSync(name);
      const row = byName.get(name);
      return {
        provider_name: name,
        enabled: row?.enabled ?? true,
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
        notice: 'API 密钥已统一在「供应商账号池」管理，请在账号池页面查看和配置密钥。',
      },
    };
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
      enabled?: boolean;
      base_url?: string;
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

    const admin = (req as any).adminUser as { username?: string };
    const operator = admin?.username || 'unknown';

    const setDoc: Record<string, unknown> = {};
    if (body.enabled !== undefined) setDoc.enabled = body.enabled;
    if (body.base_url !== undefined) setDoc.base_url = String(body.base_url).trim();
    if (body.icon_url !== undefined) setDoc.icon_url = String(body.icon_url).trim();
    if (body.extra !== undefined) setDoc.extra = body.extra;
    if (body.limits !== undefined) setDoc.limits = body.limits;
    if (body.poll_limits !== undefined) setDoc.poll_limits = body.poll_limits;

    // 已移除: api_key 参数 — 密钥统一在账号池管理

    const updated = await this.runtimeModel.findOneAndUpdate(
      { provider_name: name },
      { $set: setDoc, $inc: { revision: 1 } },
      { upsert: true, new: true },
    );

    await this.providerConfig.invalidateAndRefresh();

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
    },
    @Req() req: Request,
  ) {
    const name = decodeURIComponent(providerName);
    if (!REGISTERED_PROVIDER_NAMES.includes(name as any)) {
      return { code: 1001, message: 'Unknown provider_name' };
    }

    // 校验 cost_per_unit
    if (body.cost_per_unit !== undefined) {
      const cost = Number(body.cost_per_unit);
      if (!Number.isFinite(cost) || cost < 0) {
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

    const costConfig: Record<string, unknown> = {};
    if (body.cost_per_unit !== undefined) costConfig.cost_per_unit = Number(body.cost_per_unit);
    if (body.cost_unit !== undefined) costConfig.cost_unit = body.cost_unit;

    const updated = await this.runtimeModel.findOneAndUpdate(
      { provider_name: name },
      { $set: { cost_config: costConfig }, $inc: { revision: 1 } },
      { upsert: true, new: true },
    );

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
