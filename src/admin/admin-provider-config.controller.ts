import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
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

function maskApiKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 4) return '****';
  return `****${key.slice(-4)}`;
}

@ApiTags('管理后台 - 厂商运行时配置')
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
  @ApiOperation({ summary: '厂商运行时配置列表（MongoDB，密钥脱敏）' })
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
        api_key_masked: maskApiKey(resolved.apiKey),
        has_api_key: !!resolved.apiKey?.trim(),
        limits: resolved.limits,
        poll_limits: {
          max_per_second: resolved.pollLimits.maxPerSecond ?? resolved.limits.maxPerSecond,
          max_concurrent: resolved.pollLimits.maxConcurrent,
        },
        revision: row?.revision ?? 0,
        updatedAt: (row as { updatedAt?: Date })?.updatedAt,
      };
    });

    return { code: 0, data: { items } };
  }

  @Get(':providerName')
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '单厂商详情（密钥脱敏）' })
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
        api_key_masked: maskApiKey(resolved.apiKey),
        has_api_key: !!resolved.apiKey?.trim(),
        extra: row?.extra || {},
        limits: resolved.limits,
        poll_limits: {
          max_per_second: resolved.pollLimits.maxPerSecond ?? resolved.limits.maxPerSecond,
          max_concurrent: resolved.pollLimits.maxConcurrent,
        },
        revision: row?.revision ?? 0,
        updatedAt: (row as { updatedAt?: Date })?.updatedAt,
      },
    };
  }

  @Put(':providerName')
  @RequirePermissions('provider:update')
  @ApiOperation({ summary: 'Upsert 厂商配置写入 Mongo（不传 api_key 则不改密钥）' })
  async upsert(
    @Param('providerName') providerName: string,
    @Body()
    body: {
      enabled?: boolean;
      base_url?: string;
      api_key?: string;
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

    if (body.api_key !== undefined && body.api_key !== null && String(body.api_key).trim() !== '') {
      setDoc.api_key = String(body.api_key).trim();
    }

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
        keys: Object.keys(setDoc).filter((k) => k !== 'api_key'),
      },
      req.ip,
    );

    return { code: 0, data: { provider_name: name, revision: updated.revision } };
  }
}
