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
  ) {}

  /**
   * 查询用量账单（计费记录）列表
   *
   * 支持按 apiKey、model、billingPolicy、status、日期范围筛选，支持分页。
   */
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
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const data = await this.billingService.listRecords({
      apiKey,
      model,
      billingPolicy,
      status,
      startDate,
      endDate,
      page: p,
      pageSize: ps,
    });

    return { code: 0, data };
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
    return { code: 0, data };
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

    const data = await this.walletService.listTransactions(apiKey, {
      page: p,
      pageSize: ps,
      type,
    });

    return { code: 0, data };
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
    await this.walletService.credit(apiKey, dto.amount, dto.reason);
    const balance = await this.walletService.getBalance(apiKey);
    return { code: 0, message: '充值成功', data: balance };
  }
}
