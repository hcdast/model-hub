import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import {
  AccountPoolEntry,
  AccountPoolEntryDocument,
} from '../database/schemas/account-pool-entry.schema';
import { AccountPoolService } from '../provider/account-pool/account-pool.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { AuditLogService } from './audit-log.service';

function maskApiKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 4) return '****';
  return `****${key.slice(-4)}`;
}

@ApiTags('管理后台 - 账号池管理')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/account-pool')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminAccountPoolController {
  constructor(
    @InjectModel(AccountPoolEntry.name)
    private readonly accountModel: Model<AccountPoolEntryDocument>,
    private readonly accountPoolService: AccountPoolService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '账号池列表（分页，按 provider 筛选）' })
  @ApiQuery({ name: 'provider_name', required: false })
  @ApiQuery({ name: 'enabled', required: false, description: 'true/false' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '查询成功' })
  async list(
    @Query('provider_name') providerName?: string,
    @Query('enabled') enabled?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ): Promise<Record<string, any>> {
    const query: Record<string, unknown> = {};
    if (providerName) query.provider_name = providerName;
    if (enabled === 'true') query.enabled = true;
    if (enabled === 'false') query.enabled = false;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const [rows, total] = await Promise.all([
      this.accountModel
        .find(query)
        .sort({ provider_name: 1, weight: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      this.accountModel.countDocuments(query),
    ]);

    const items = rows.map((r) => ({
      ...r,
      api_key: maskApiKey(r.api_key),
    }));

    return { code: 0, data: { items, total, page: p, pageSize: ps } };
  }

  @Get(':id')
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '账号详情（API Key 脱敏）' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async detail(@Param('id') id: string): Promise<Record<string, any>> {
    const row = await this.accountModel.findById(id).lean();
    if (!row) return { code: 3001, message: 'Account not found' };
    return {
      code: 0,
      data: { ...row, api_key: maskApiKey(row.api_key) },
    };
  }

  @Post()
  @RequirePermissions('provider:create')
  @ApiOperation({ summary: '创建账号' })
  @ApiResponse({ status: 200, description: '创建成功' })
  async create(
    @Body()
    body: {
      provider_name: string;
      account_alias: string;
      api_key: string;
      base_url?: string;
      weight?: number;
      enabled?: boolean;
      daily_cost_limit?: number;
      monthly_cost_limit?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    },
    @Req() req: Request,
  ) {
    const admin = (req as any).adminUser as { username?: string };
    const operator = admin?.username || 'unknown';

    // Validate using AccountPoolService
    try {
      this.accountPoolService.validateAccountEntry(body);
    } catch (err: any) {
      return { code: 1001, message: err.message };
    }

    // Check duplicate api_key
    const dup = await this.accountPoolService.isDuplicateApiKey(
      body.provider_name,
      body.api_key,
    );
    if (dup) {
      return {
        code: 1002,
        message: `Duplicate api_key for provider ${body.provider_name}`,
      };
    }

    try {
      const doc = await this.accountModel.create({
        provider_name: body.provider_name,
        account_alias: body.account_alias,
        api_key: body.api_key,
        base_url: body.base_url,
        weight: body.weight ?? 1,
        enabled: body.enabled ?? true,
        daily_cost_limit: body.daily_cost_limit ?? 0,
        monthly_cost_limit: body.monthly_cost_limit ?? 0,
        tags: body.tags ?? [],
        metadata: body.metadata ?? {},
      });

      // Refresh pool so the new account is available quickly
      await this.accountPoolService.refreshPool(body.provider_name);

      await this.auditLog.log(
        'account_pool.create',
        operator,
        { provider_name: body.provider_name, account_alias: body.account_alias },
        req.ip,
      );

      return {
        code: 0,
        data: { ...doc.toObject(), api_key: maskApiKey(doc.api_key) },
      };
    } catch (err: any) {
      if (err.code === 11000) {
        return {
          code: 1002,
          message: `Duplicate api_key for provider ${body.provider_name}`,
        };
      }
      return { code: 500, message: err.message || '创建失败' };
    }
  }

  @Put(':id')
  @RequirePermissions('provider:update')
  @ApiOperation({ summary: '更新账号' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      account_alias?: string;
      api_key?: string;
      base_url?: string;
      weight?: number;
      enabled?: boolean;
      daily_cost_limit?: number;
      monthly_cost_limit?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    },
    @Req() req: Request,
  ) {
    const admin = (req as any).adminUser as { username?: string };
    const operator = admin?.username || 'unknown';

    const existing = await this.accountModel.findById(id).lean();
    if (!existing) return { code: 3001, message: 'Account not found' };

    // Validate weight if provided
    if (body.weight !== undefined) {
      if (typeof body.weight !== 'number' || body.weight <= 0) {
        return { code: 1001, message: 'weight must be a positive number' };
      }
    }

    // Check duplicate api_key if changing
    if (body.api_key && body.api_key !== existing.api_key) {
      const dup = await this.accountPoolService.isDuplicateApiKey(
        existing.provider_name,
        body.api_key,
        id,
      );
      if (dup) {
        return {
          code: 1002,
          message: `Duplicate api_key for provider ${existing.provider_name}`,
        };
      }
    }

    const setDoc: Record<string, unknown> = {};
    if (body.account_alias !== undefined) setDoc.account_alias = body.account_alias;
    if (body.api_key !== undefined) setDoc.api_key = body.api_key;
    if (body.base_url !== undefined) setDoc.base_url = body.base_url;
    if (body.weight !== undefined) setDoc.weight = body.weight;
    if (body.enabled !== undefined) setDoc.enabled = body.enabled;
    if (body.daily_cost_limit !== undefined) setDoc.daily_cost_limit = body.daily_cost_limit;
    if (body.monthly_cost_limit !== undefined) setDoc.monthly_cost_limit = body.monthly_cost_limit;
    if (body.tags !== undefined) setDoc.tags = body.tags;
    if (body.metadata !== undefined) setDoc.metadata = body.metadata;

    const updated = await this.accountModel.findByIdAndUpdate(
      id,
      { $set: setDoc, $inc: { revision: 1 } },
      { new: true },
    );

    // Refresh pool so changes take effect quickly
    await this.accountPoolService.refreshPool(existing.provider_name);

    await this.auditLog.log(
      'account_pool.update',
      operator,
      {
        account_id: id,
        provider_name: existing.provider_name,
        keys: Object.keys(setDoc).filter((k) => k !== 'api_key'),
      },
      req.ip,
    );

    return {
      code: 0,
      data: updated
        ? { ...updated.toObject(), api_key: maskApiKey(updated.api_key) }
        : null,
    };
  }

  @Delete(':id')
  @RequirePermissions('provider:delete')
  @ApiOperation({ summary: '删除账号' })
  @ApiResponse({ status: 200, description: '删除成功' })
  async remove(@Param('id') id: string, @Req() req: Request) {
    const admin = (req as any).adminUser as { username?: string };
    const operator = admin?.username || 'unknown';

    const existing = await this.accountModel.findById(id).lean();
    if (!existing) return { code: 3001, message: 'Account not found' };

    await this.accountModel.findByIdAndDelete(id);

    // Refresh pool so the deleted account is removed quickly
    await this.accountPoolService.refreshPool(existing.provider_name);

    await this.auditLog.log(
      'account_pool.delete',
      operator,
      {
        account_id: id,
        provider_name: existing.provider_name,
        account_alias: existing.account_alias,
      },
      req.ip,
    );

    return { code: 0, data: { deleted: true } };
  }
}
