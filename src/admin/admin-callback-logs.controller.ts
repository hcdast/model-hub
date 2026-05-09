import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CallbackLog, CallbackLogDocument } from '../database/schemas/callback-log.schema';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';

@ApiTags('管理后台 - 回调日志')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/callback-logs')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminCallbackLogsController {
  constructor(
    @InjectModel(CallbackLog.name)
    private readonly callbackLogModel: Model<CallbackLogDocument>,
  ) {}

  @Get()
  @RequirePermissions('callback-log:read')
  @ApiOperation({ summary: '回调投递日志列表', description: '按任务、结果、时间筛选（TTL 集合，默认保留约 30 天）' })
  @ApiQuery({ name: 'taskId', required: false })
  @ApiQuery({ name: 'success', required: false, description: 'true / false' })
  @ApiQuery({ name: 'responseCode', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 时间起始' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 时间结束' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '查询成功' })
  async list(
    @Query('taskId') taskId?: string,
    @Query('success') success?: string,
    @Query('responseCode') responseCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const query: Record<string, unknown> = {};
    if (taskId?.trim()) query.taskId = taskId.trim();
    if (success === 'true') query.success = true;
    if (success === 'false') query.success = false;
    if (responseCode != null && responseCode !== '') {
      const n = parseInt(responseCode, 10);
      if (!Number.isNaN(n)) query.responseCode = n;
    }
    if (from || to) {
      const range: { $gte?: Date; $lte?: Date } = {};
      if (from) range.$gte = new Date(from);
      if (to) range.$lte = new Date(to);
      query.createdAt = range;
    }

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const [items, total] = await Promise.all([
      this.callbackLogModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .lean(),
      this.callbackLogModel.countDocuments(query),
    ]);

    return { code: 0, data: { items, total, page: p, pageSize: ps } };
  }
}
