import { BadRequestException } from '@nestjs/common';
import {
  Controller,
  Get,
  Query,
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
import {
  AccountCostDaily,
  AccountCostDailyDocument,
} from '../database/schemas/account-cost-daily.schema';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { roundMoney } from '../common/utils/money.util';
import { reportRange } from './utils/report-range';

@ApiTags('管理后台 - 成本分析')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/account-costs')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminAccountCostController {
  constructor(
    @InjectModel(AccountCostDaily.name)
    private readonly costModel: Model<AccountCostDailyDocument>,
  ) {}

  @Get('summary')
  @RequirePermissions('provider:read')
  async rangeSummary(@Query('provider_name') provider?: string, @Query('account_id') account?: string,
    @Query('start_date') start?: string, @Query('end_date') end?: string) {
    const range = reportRange(start, end);
    const match: Record<string, unknown> = { date: { $gte: range.start, $lte: range.end } };
    if (provider) match.provider_name = provider;
    if (account) match.account_id = account;
    const [result] = await this.costModel.aggregate([
      { $match: match },
      { $facet: {
        items: [{ $group: { _id: { account_id: '$account_id', provider_name: '$provider_name' }, total_cost: { $sum: '$total_cost' }, total_requests: { $sum: '$request_count' }, total_success: { $sum: '$success_count' }, total_failure: { $sum: '$failure_count' }, latency: { $sum: { $multiply: ['$avg_latency_ms', '$request_count'] } }, days: { $sum: 1 } } },
          { $project: { _id: 0, account_id: '$_id.account_id', provider_name: '$_id.provider_name', total_cost: 1, total_requests: 1, total_success: 1, total_failure: 1, days: 1, avg_latency_ms: { $cond: [{ $gt: ['$total_requests', 0] }, { $divide: ['$latency', '$total_requests'] }, 0] } } }],
        trend: [{ $group: { _id: { date: '$date', provider_name: '$provider_name' }, total_cost: { $sum: '$total_cost' } } }, { $project: { _id: 0, date: '$_id.date', provider_name: '$_id.provider_name', total_cost: 1 } }, { $sort: { date: 1 } }],
      } },
    ]);
    return { code: 0, data: { items: result?.items || [], trend: result?.trend || [], dateFrom: range.start, dateTo: range.end, timezone: 'UTC', generatedAt: new Date().toISOString() } };
  }

  @Get()
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '成本分析日明细（支持按 provider、account、时间范围筛选）' })
  @ApiQuery({ name: 'provider_name', required: false })
  @ApiQuery({ name: 'account_id', required: false })
  @ApiQuery({ name: 'start_date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'end_date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listDaily(
    @Query('provider_name') providerName?: string,
    @Query('account_id') accountId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ): Promise<{ code: number; data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    const query: Record<string, unknown> = {};
    if (providerName) query.provider_name = providerName;
    if (accountId) query.account_id = accountId;
    if (startDate || endDate) {
      reportRange(startDate, endDate);
      const dateFilter: Record<string, string> = {};
      if (startDate) dateFilter.$gte = startDate;
      if (endDate) dateFilter.$lte = endDate;
      query.date = dateFilter;
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const [rows, total] = await Promise.all([
      this.costModel
        .find(query)
        .sort({ date: -1, provider_name: 1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      this.costModel.countDocuments(query),
    ]);

    const items = rows.map((row) => ({
      ...row,
      total_cost: typeof row.total_cost === 'number' ? roundMoney(row.total_cost) : row.total_cost,
    }));

    return { code: 0, data: { items, total, page: p, pageSize: ps } };
  }

  @Get('monthly')
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '成本分析月聚合' })
  @ApiQuery({ name: 'provider_name', required: false })
  @ApiQuery({ name: 'account_id', required: false })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM，默认当月' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async monthlyAggregate(
    @Query('provider_name') providerName?: string,
    @Query('account_id') accountId?: string,
    @Query('month') month?: string,
  ): Promise<{ code: number; data: { items: Record<string, unknown>[]; month: string } }> {
    const m = month || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new BadRequestException('月份必须为 YYYY-MM');

    const matchStage: Record<string, unknown> = {
      date: { $regex: `^${m}` },
    };
    if (providerName) matchStage.provider_name = providerName;
    if (accountId) matchStage.account_id = accountId;

    const results = await this.costModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { account_id: '$account_id', provider_name: '$provider_name' },
          total_cost: { $sum: '$total_cost' },
          total_requests: { $sum: '$request_count' },
          total_success: { $sum: '$success_count' },
          total_failure: { $sum: '$failure_count' },
          avg_latency_ms: { $avg: '$avg_latency_ms' },
          days: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          account_id: '$_id.account_id',
          provider_name: '$_id.provider_name',
          month: m,
          total_cost: 1,
          total_requests: 1,
          total_success: 1,
          total_failure: 1,
          avg_latency_ms: { $round: ['$avg_latency_ms', 2] },
          days: 1,
        },
      },
      { $sort: { provider_name: 1, total_cost: -1 } },
    ]);

    const items = results.map((row: Record<string, unknown>) => ({
      ...row,
      total_cost:
        typeof row.total_cost === 'number' ? roundMoney(row.total_cost) : row.total_cost,
    }));

    return { code: 0, data: { items, month: m } };
  }
}
