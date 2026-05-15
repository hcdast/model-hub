import {
  BadRequestException,
  Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { ApiClientService } from '../api-client/api-client.service';
import { UsageTrackerService } from '../api-client/usage-tracker.service';
import { UpdateRateLimitsDto } from './dto/update-rate-limits.dto';
import { UpdateModelAllowlistDto } from './dto/update-model-allowlist.dto';
import { UsageQueryDto } from './dto/usage-query.dto';

@ApiTags('管理后台 - 应用与 API 密钥')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/api-clients')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminApiClientController {
  constructor(
    private readonly apiClients: ApiClientService,
    private readonly usageTracker: UsageTrackerService,
  ) {}

  @Get()
  @RequirePermissions('api-client:read')
  @ApiOperation({ summary: '应用 / 客户端列表' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '成功' })
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const data = await this.apiClients.list(p, ps);
    return { code: 0, data };
  }

  @Post()
  @RequirePermissions('api-client:create')
  @ApiOperation({ summary: '创建客户端（主键与调用凭据相同，仅创建时返回一次完整凭据）' })
  @ApiResponse({ status: 200, description: '成功' })
  async create(@Body() body: {
    name?: string;
    billingPolicy?: string;
    defaultPriority?: number;
    rateLimits?: { maxQps?: number; maxConcurrent?: number; maxDailyRequests?: number };
    modelAllowlist?: string[];
  }) {
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : undefined;
    const billingPolicy = typeof body?.billingPolicy === 'string' ? body.billingPolicy : undefined;
    const defaultPriority = typeof body?.defaultPriority === 'number' ? body.defaultPriority : undefined;
    const rateLimits = body?.rateLimits && typeof body.rateLimits === 'object' ? body.rateLimits : undefined;
    const modelAllowlist = Array.isArray(body?.modelAllowlist) ? body.modelAllowlist : undefined;

    const result = await this.apiClients.createClient(name, billingPolicy, defaultPriority, rateLimits, modelAllowlist);
    return {
      code: 0,
      message: 'Save fullCredential (same as apiKey for new clients) now; it will not be shown again.',
      data: {
        apiKey: result.apiKey,
        name: result.name,
        billingPolicy: result.billingPolicy,
        fullCredential: result.plainKey,
      },
    };
  }

  @Patch(':apiKey')
  @RequirePermissions('api-client:update')
  @ApiOperation({ summary: '启用 / 禁用客户端' })
  @ApiResponse({ status: 200, description: '成功' })
  async patchEnabled(
    @Param('apiKey') apiKey: string,
    @Body() body: { enabled?: boolean },
  ) {
    this.apiClients.assertApiKeyParam(apiKey);
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    await this.apiClients.setEnabled(apiKey, body.enabled);
    return { code: 0, message: 'Updated' };
  }

  @Post(':apiKey/rotate')
  @RequirePermissions('api-client:update')
  @ApiOperation({
    summary: '轮换密钥（新复合凭据仅返回一次；仅旧版「主键.secret」客户端可用）',
  })
  @ApiResponse({ status: 200, description: '成功' })
  async rotate(@Param('apiKey') apiKey: string) {
    this.apiClients.assertApiKeyParam(apiKey);
    const { plainKey } = await this.apiClients.rotateSecret(apiKey);
    return {
      code: 0,
      message: 'Save the new compound apiKey now; it will not be shown again.',
      data: { apiKey, fullCredential: plainKey },
    };
  }

  @Patch(':apiKey/priority')
  @RequirePermissions('api-client:update')
  @ApiOperation({ summary: '更新客户端默认优先级' })
  @ApiResponse({ status: 200, description: '成功' })
  async updateDefaultPriority(
    @Param('apiKey') apiKey: string,
    @Body() body: { defaultPriority?: number },
  ) {
    this.apiClients.assertApiKeyParam(apiKey);
    if (body?.defaultPriority == null || typeof body.defaultPriority !== 'number') {
      throw new BadRequestException('defaultPriority must be a number');
    }
    await this.apiClients.updateDefaultPriority(apiKey, body.defaultPriority);
    return { code: 0, message: 'Updated' };
  }

  @Patch(':apiKey/billing-policy')
  @RequirePermissions('api-client:update')
  @ApiOperation({ summary: '修改客户端计费策略' })
  @ApiResponse({ status: 200, description: '成功' })
  async updateBillingPolicy(
    @Param('apiKey') apiKey: string,
    @Body() body: { billingPolicy?: string },
  ) {
    this.apiClients.assertApiKeyParam(apiKey);
    if (!body?.billingPolicy || typeof body.billingPolicy !== 'string') {
      throw new BadRequestException('billingPolicy must be a string');
    }
    await this.apiClients.updateBillingPolicy(apiKey, body.billingPolicy);
    return { code: 0, message: 'Updated' };
  }

  // ===== 新增端点：限流配置、模型白名单、用量查询 =====

  @Put(':apiKey/rate-limits')
  @RequirePermissions('api-client:update')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: '更新客户端限流配置' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 404, description: '客户端不存在' })
  async updateRateLimits(
    @Param('apiKey') apiKey: string,
    @Body() dto: UpdateRateLimitsDto,
  ) {
    this.apiClients.assertApiKeyParam(apiKey);
    await this.apiClients.updateRateLimits(apiKey, {
      maxQps: dto.maxQps,
      maxConcurrent: dto.maxConcurrent,
      maxDailyRequests: dto.maxDailyRequests,
    });
    return { code: 0, message: 'Rate limits updated' };
  }

  @Put(':apiKey/model-allowlist')
  @RequirePermissions('api-client:update')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: '更新客户端模型白名单' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 404, description: '客户端不存在' })
  async updateModelAllowlist(
    @Param('apiKey') apiKey: string,
    @Body() dto: UpdateModelAllowlistDto,
  ) {
    this.apiClients.assertApiKeyParam(apiKey);
    await this.apiClients.updateModelAllowlist(apiKey, dto.modelAllowlist);
    return { code: 0, message: 'Model allowlist updated' };
  }

  @Get('usage/summary')
  @RequirePermissions('api-client:read')
  @ApiOperation({ summary: '查询所有客户端用量汇总' })
  @ApiResponse({ status: 200, description: '成功' })
  async getUsageSummary() {
    const data = await this.usageTracker.getUsageSummary();
    return { code: 0, data };
  }

  @Get(':apiKey/usage')
  @RequirePermissions('api-client:read')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: '查询客户端用量统计' })
  @ApiQuery({ name: 'from', required: false, description: '起始日期（YYYYMMDD）' })
  @ApiQuery({ name: 'to', required: false, description: '结束日期（YYYYMMDD）' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 404, description: '客户端不存在' })
  async getUsage(
    @Param('apiKey') apiKey: string,
    @Query() query: UsageQueryDto,
  ) {
    this.apiClients.assertApiKeyParam(apiKey);
    // 默认查询当天
    const today = this.getTodayStr();
    const from = query.from || today;
    const to = query.to || today;
    const data = await this.usageTracker.getUsage(apiKey, { from, to });
    return { code: 0, data };
  }

  /** 获取当天日期字符串 YYYYMMDD */
  private getTodayStr(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}
