import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminJwtGuard } from '../../admin/guards/admin-jwt.guard';
import { PermissionGuard } from '../../admin/guards/permission.guard';
import { RequirePermissions } from '../../admin/decorators/require-permissions.decorator';
import { NotificationService, RecordFilters } from '../services/notification.service';

@ApiTags('管理后台 - 通知记录')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/notification-records')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class NotificationRecordController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @RequirePermissions('notification:read')
  @ApiOperation({ summary: '通知记录列表' })
  @ApiQuery({ name: 'eventType', required: false })
  @ApiQuery({ name: 'channelType', required: false })
  @ApiQuery({ name: 'status', required: false, description: 'success/failed/suppressed' })
  @ApiQuery({ name: 'startTime', required: false, description: 'ISO date string' })
  @ApiQuery({ name: 'endTime', required: false, description: 'ISO date string' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '查询成功' })
  async list(
    @Query('eventType') eventType?: string,
    @Query('channelType') channelType?: string,
    @Query('status') status?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const filters: RecordFilters = {};
    if (eventType) filters.eventType = eventType;
    if (channelType) filters.channelType = channelType;
    if (status) filters.status = status;
    if (startTime) filters.startTime = new Date(startTime);
    if (endTime) filters.endTime = new Date(endTime);

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const result = await this.notificationService.listRecords(filters, p, ps);
    return { code: 0, data: result };
  }
}
