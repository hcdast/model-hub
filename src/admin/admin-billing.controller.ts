import { BadRequestException } from '@nestjs/common';
import { BillingQueryDto } from '../billing/dto/billing-query.dto';
import { csvCell } from './utils/csv';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { BillingService } from '../billing/billing.service';
import { WalletService } from '../billing/wallet.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiClient, ApiClientDocument } from '../database/schemas/api-client.schema';
import { withClientDisplay, resolveAdminClientKey } from './utils/client-display';
import { CreditWalletDto } from '../billing/dto/credit-wallet.dto';

/**
 * 管理后台 - 计费与成本控制器
 *
 * 提供用量账单查询、计费汇总、钱包余额查询、交易记录查询和手动充值等功能。
 * 所有端点均需要 AdminJwt 认证和对应权限。
 */
@ApiTags('管理后台 - 计费与成本')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/billing')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminBillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly walletService: WalletService,
    @InjectModel(ApiClient.name) private readonly clientModel?: Model<ApiClientDocument>,
  ) {}

  /**
   * 查询用量账单（计费记录）列表
   *
   * 支持按 apiKey、model、billingPolicy、status、日期范围筛选，支持分页。
   */
  @Post('records/export')
  @RequirePermissions('billing:read')
  async exportRecords(@Body() body: BillingQueryDto) {
    const generatedAt = new Date().toISOString();
    const endDate = body.endDate && body.endDate < generatedAt ? body.endDate : generatedAt;
    const filters = { ...body, endDate, apiKey: await resolveAdminClientKey(this.clientModel!, body.apiKey), pageSize: 100 };
    const rows: any[] = [];
    let expectedTotal: number | undefined;
    for (let page = 1; ; page++) {
      const data = await this.billingService.listRecords({ ...filters, page });
      expectedTotal ??= data.total;
      if (data.total > 50000) throw new BadRequestException('导出上限为 50000 条，请缩小筛选范围');
      if (data.total !== expectedTotal) throw new BadRequestException('导出期间记录数量变化，请重新导出');
      rows.push(...await withClientDisplay(this.clientModel!, data.items as any[]));
      if (rows.length >= data.total || !data.items.length) break;
    }
    const header = ['taskId', 'clientName', 'clientRef', 'maskedKey', 'model', 'provider', 'usageType', 'estimatedCost', 'actualCost', 'currency', 'billingPolicy', 'status', 'createdAt_UTC'];
    const csv = '\uFEFF' + [header, ...rows.map(r => [r.taskId, r.clientName, r.clientRef, r.apiKey, r.model, r.provider, r.usageType, r.estimatedCost, r.actualCost, r.currency, r.billingPolicy, r.status, r.createdAt ? new Date(r.createdAt).toISOString() : ''])].map(row => row.map(csvCell).join(',')).join('\r\n');
    return { code: 0, data: { csv, total: rows.length, generatedAt, timezone: 'UTC' } };
  }

  @Get('records')
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: '查询用量账单' })
  @ApiQuery({ name: 'apiKey', required: false, description: '客户端主键（apiKey）筛选' })
  @ApiQuery({ name: 'model', required: false, description: '模型名称筛选' })
  @ApiQuery({ name: 'billingPolicy', required: false, description: '计费策略筛选', enum: ['internal', 'external'] })
  @ApiQuery({ name: 'status', required: false, description: '计费状态筛选', enum: ['estimated', 'pre_deducted', 'settled', 'refunded', 'failed'] })
  @ApiQuery({ name: 'start_date', required: false, description: '开始日期（ISO 格式）' })
  @ApiQuery({ name: 'end_date', required: false, description: '结束日期（ISO 格式）' })
  @ApiQuery({ name: 'page', required: false, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页数量' })
  @ApiResponse({ status: 200, description: '成功' })
  async listRecords(
    @Query('apiKey') apiKey?: string,
    @Query('model') model?: string,
    @Query('billingPolicy') billingPolicy?: string,
    @Query('status') status?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('taskId') taskId?: string,
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const data = await this.billingService.listRecords({
      taskId,
      apiKey: await resolveAdminClientKey(this.clientModel!, apiKey),
      model,
      billingPolicy,
      status,
      startDate,
      endDate,
      page: p,
      pageSize: ps,
    });

    return { code: 0, data: { ...data, items: await withClientDisplay(this.clientModel!, data.items as any[]) } };
  }

  /**
   * 计费汇总
   *
   * 支持按模型、客户端、日期分组聚合，支持按 billingPolicy 和日期范围筛选。
   */
  @Get('summary')
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: '计费汇总' })
  @ApiQuery({ name: 'groupBy', required: false, description: '分组维度', enum: ['model', 'apiKey', 'date'] })
  @ApiQuery({ name: 'billingPolicy', required: false, description: '计费策略筛选', enum: ['internal', 'external'] })
  @ApiQuery({ name: 'start_date', required: false, description: '开始日期（ISO 格式）' })
  @ApiQuery({ name: 'end_date', required: false, description: '结束日期（ISO 格式）' })
  @ApiResponse({ status: 200, description: '成功' })
  async getSummary(
    @Query('groupBy') groupBy?: 'model' | 'apiKey' | 'date',
    @Query('billingPolicy') billingPolicy?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    const data = await this.billingService.getSummary({
      groupBy,
      billingPolicy,
      startDate,
      endDate,
    });

    if (groupBy === 'apiKey') {
      const rows = await withClientDisplay(this.clientModel!, data.map(r => ({ ...r, apiKey: r._id })));
      return { code: 0, data: rows.map((r: any) => ({ ...r, _id: r.clientName, apiKey: r.apiKey })) };
    }
    return { code: 0, data };
  }

  /**
   * 查询钱包列表（分页 + 搜索）
   */
  @Get('wallets')
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: '查询钱包列表' })
  @ApiQuery({ name: 'keyword', required: false, description: '搜索关键字（apiKey）' })
  @ApiQuery({ name: 'page', required: false, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页数量' })
  @ApiResponse({ status: 200, description: '成功' })
  async listWallets(
    @Query('keyword') keyword?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const data = await this.walletService.listWallets({ keyword, page: p, pageSize: ps });
    const items = await withClientDisplay(this.clientModel!, data.items as any[]);
    return { code: 0, data: { ...data, items: items.map((row: any) => ({ ...row, clientRef: row.clientRef || `wallet:${row._id}`, name: row.clientName })) } };
  }

  /**
   * 查询指定 API Client 的钱包余额
   */
  @Get('wallets/:apiKey')
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: '查询钱包余额' })
  @ApiParam({ name: 'apiKey', description: '客户端主键（apiKey）' })
  @ApiResponse({ status: 200, description: '成功' })
  async getWallet(@Param('apiKey') apiKey: string) {
    apiKey = (await resolveAdminClientKey(this.clientModel!, apiKey))!;
    const data = await this.walletService.getBalance(apiKey);
    return { code: 0, data };
  }

  /**
   * 查询指定 API Client 的钱包交易记录
   */
  @Get('wallets/:apiKey/transactions')
  @RequirePermissions('billing:read')
  @ApiOperation({ summary: '查询交易记录' })
  @ApiParam({ name: 'apiKey', description: '客户端主键（apiKey）' })
  @ApiQuery({ name: 'page', required: false, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页数量' })
  @ApiQuery({ name: 'type', required: false, description: '交易类型筛选', enum: ['credit', 'debit', 'freeze', 'unfreeze'] })
  @ApiResponse({ status: 200, description: '成功' })
  async listTransactions(
    @Param('apiKey') apiKey: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('type') type?: string,
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    apiKey = (await resolveAdminClientKey(this.clientModel!, apiKey))!;
    const data = await this.walletService.listTransactions(apiKey, {
      page: p,
      pageSize: ps,
      type,
    });

    return { code: 0, data: { ...data, items: await withClientDisplay(this.clientModel!, data.items as any[]) } };
  }

  /**
   * 手动充值 —— 为指定 API Client 的钱包充值
   *
   * 仅限拥有 billing:write 权限的管理员操作。
   */
  @Post('wallets/:apiKey/credit')
  @RequirePermissions('billing:write')
  @ApiOperation({ summary: '手动充值' })
  @ApiParam({ name: 'apiKey', description: '客户端主键（apiKey）' })
  @ApiResponse({ status: 200, description: '充值成功' })
  async creditWallet(
    @Param('apiKey') apiKey: string,
    @Body() dto: CreditWalletDto,
  ) {
    apiKey = (await resolveAdminClientKey(this.clientModel!, apiKey))!;
    await this.walletService.credit(apiKey, dto.amount, dto.reason);
    const balance = await this.walletService.getBalance(apiKey);
    return { code: 0, message: '充值成功', data: balance };
  }
}
