import {
  BadRequestException,
  Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { ApiClientService } from '../api-client/api-client.service';
import { UsageTrackerService } from '../api-client/usage-tracker.service';
import { UpdateRateLimitsDto } from './dto/update-rate-limits.dto';
import { UpdateModelAllowlistDto } from './dto/update-model-allowlist.dto';
import { UsageQueryDto } from './dto/usage-query.dto';
import { CreateApiClientDto } from './dto/create-api-client.dto';
import { PortalApiKey, PortalApiKeyDocument } from '../database/schemas/portal-api-key.schema';
import { PortalUser, PortalUserDocument } from '../database/schemas/portal-user.schema';

@ApiTags('管理后台 - 应用与 API 密钥')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/api-clients')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminApiClientController {
  constructor(
    private readonly apiClients: ApiClientService,
    private readonly usageTracker: UsageTrackerService,
    @InjectModel(PortalApiKey.name)
    private readonly portalApiKeyModel: Model<PortalApiKeyDocument>,
    @InjectModel(PortalUser.name)
    private readonly portalUserModel: Model<PortalUserDocument>,
  ) {}

  @Get()
  @RequirePermissions('api-client:read')
  @ApiOperation({ summary: '应用 / 客户端列表（包含 Portal 用户创建的 Key）' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '成功' })
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const offset = (p - 1) * ps;
    const [adminTotal, portalTotal] = await Promise.all([
      this.apiClients.count(),
      this.portalApiKeyModel.countDocuments({ enabled: true }),
    ]);

    const adminItems =
      offset < adminTotal
        ? await this.apiClients.listSlice(offset, ps)
        : [];
    const remaining = ps - adminItems.length;
    const portalOffset = Math.max(0, offset - adminTotal);
    const portalKeys =
      remaining > 0
        ? await this.portalApiKeyModel
            .find({ enabled: true })
            .sort({ createdAt: -1 })
            .skip(portalOffset)
            .limit(remaining)
            .lean()
        : [];
    const userIds = [...new Set(portalKeys.map((key) => key.userId))];
    const users = await this.portalUserModel
      .find({ _id: { $in: userIds } })
      .select('_id email username')
      .lean();
    const userMap = new Map(users.map((user) => [user._id.toString(), user]));
    const portalItems = portalKeys.map((key) => {
      const user = userMap.get(key.userId);
      return {
        id: key._id.toString(),
        apiKey: key.maskedKey,
        name: key.name,
        enabled: key.enabled,
        source: 'portal',
        portalUser: user
          ? {
              id: user._id.toString(),
              email: user.email,
              username: user.username,
            }
          : null,
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
      };
    });
    const items = [
      ...adminItems.map((item) => ({ ...item, source: 'admin' })),
      ...portalItems,
    ];
    const total = adminTotal + portalTotal;

    return {
      code: 0,
      data: {
        items,
        total,
        page: p,
        pageSize: ps,
        totalPages: Math.ceil(total / ps),
      },
    };
  }

  @Post()
  @RequirePermissions('api-client:create')
  @ApiOperation({ summary: '创建客户端（主键与调用凭据相同，仅创建时返回一次完整凭据）' })
  @ApiResponse({ status: 200, description: '成功' })
  async create(@Body() body: CreateApiClientDto) {
    const name = body.name?.trim() || undefined;
    const billingPolicy = body.billingPolicy;
    const defaultPriority = body.defaultPriority;
    const rateLimits = body.rateLimits;
    const modelAllowlist = body.modelAllowlist;

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

  @Patch(':id')
  @RequirePermissions('api-client:update')
  @ApiOperation({ summary: '启用 / 禁用客户端' })
  @ApiResponse({ status: 200, description: '成功' })
  async patchEnabled(
    @Param('id') id: string,
    @Body() body: { enabled?: boolean },
  ) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    const apiKey = await this.apiClients.getCredentialKeyForAdmin(id);
    await this.apiClients.setEnabled(apiKey, body.enabled);
    return { code: 0, message: 'Updated' };
  }

  @Post(':id/rotate')
  @RequirePermissions('api-client:update')
  @ApiOperation({
    summary: '轮换密钥（新复合凭据仅返回一次；仅旧版客户端可用）',
  })
  @ApiResponse({ status: 200, description: '成功' })
  async rotate(@Param('id') id: string) {
    const apiKey = await this.apiClients.getCredentialKeyForAdmin(id);
    const { plainKey } = await this.apiClients.rotateSecret(apiKey);
    return {
      code: 0,
      message: 'Save the new compound API Key now; it will not be shown again.',
      data: { fullCredential: plainKey },
    };
  }

  @Patch(':id/priority')
  @RequirePermissions('api-client:update')
  @ApiOperation({ summary: '更新客户端默认优先级' })
  @ApiResponse({ status: 200, description: '成功' })
  async updateDefaultPriority(
    @Param('id') id: string,
    @Body() body: { defaultPriority?: number },
  ) {
    if (body?.defaultPriority == null || typeof body.defaultPriority !== 'number') {
      throw new BadRequestException('defaultPriority must be a number');
    }
    const apiKey = await this.apiClients.getCredentialKeyForAdmin(id);
    await this.apiClients.updateDefaultPriority(apiKey, body.defaultPriority);
    return { code: 0, message: 'Updated' };
  }

  @Patch(':id/billing-policy')
  @RequirePermissions('api-client:update')
  @ApiOperation({ summary: '修改客户端计费策略' })
  @ApiResponse({ status: 200, description: '成功' })
  async updateBillingPolicy(
    @Param('id') id: string,
    @Body() body: { billingPolicy?: string },
  ) {
    if (!body?.billingPolicy || typeof body.billingPolicy !== 'string') {
      throw new BadRequestException('billingPolicy must be a string');
    }
    const apiKey = await this.apiClients.getCredentialKeyForAdmin(id);
    await this.apiClients.updateBillingPolicy(apiKey, body.billingPolicy);
    return { code: 0, message: 'Updated' };
  }

  // ===== 新增端点：限流配置、模型白名单、用量查询 =====

  @Put(':id/rate-limits')
  @RequirePermissions('api-client:update')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: '更新客户端限流配置' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 404, description: '客户端不存在' })
  async updateRateLimits(
    @Param('id') id: string,
    @Body() dto: UpdateRateLimitsDto,
  ) {
    const apiKey = await this.apiClients.getCredentialKeyForAdmin(id);
    await this.apiClients.updateRateLimits(apiKey, {
      maxQps: dto.maxQps,
      maxConcurrent: dto.maxConcurrent,
      maxDailyRequests: dto.maxDailyRequests,
    });
    return { code: 0, message: 'Rate limits updated' };
  }

  @Put(':id/model-allowlist')
  @RequirePermissions('api-client:update')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: '更新客户端模型白名单' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 400, description: '参数校验失败' })
  @ApiResponse({ status: 404, description: '客户端不存在' })
  async updateModelAllowlist(
    @Param('id') id: string,
    @Body() dto: UpdateModelAllowlistDto,
  ) {
    const apiKey = await this.apiClients.getCredentialKeyForAdmin(id);
    await this.apiClients.updateModelAllowlist(apiKey, dto.modelAllowlist);
    return { code: 0, message: 'Model allowlist updated' };
  }

  @Get('usage/summary')
  @RequirePermissions('api-client:read')
  @ApiOperation({ summary: '查询所有客户端用量汇总' })
  @ApiResponse({ status: 200, description: '成功' })
  async getUsageSummary() {
    const summaries = await this.usageTracker.getUsageSummary();
    const identities = await this.apiClients.getManagementIdentityMap(
      summaries.map((item) => item.apiKey),
    );
    const data = summaries.flatMap((item) => {
      const identity = identities.get(item.apiKey);
      return identity ? [{ ...item, ...identity }] : [];
    });
    return { code: 0, data };
  }

  @Get(':id/usage')
  @RequirePermissions('api-client:read')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: '查询客户端用量统计' })
  @ApiQuery({ name: 'from', required: false, description: '起始日期（YYYYMMDD）' })
  @ApiQuery({ name: 'to', required: false, description: '结束日期（YYYYMMDD）' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 404, description: '客户端不存在' })
  async getUsage(
    @Param('id') id: string,
    @Query() query: UsageQueryDto,
  ) {
    const apiKey = await this.apiClients.getCredentialKeyForAdmin(id);
    const today = this.getTodayStr();
    const from = query.from || today;
    const to = query.to || today;
    const usage = await this.usageTracker.getUsage(apiKey, { from, to });
    const identity = (await this.apiClients.getManagementIdentityMap([apiKey]))
      .get(apiKey);
    const data = usage.map((item) => ({
      ...item,
      id,
      apiKey: identity?.apiKey ?? '********',
    }));
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
