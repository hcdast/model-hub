import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  UseGuards,
  NotFoundException,
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
import { InAppNotificationService } from '../services/in-app-notification.service';

@ApiTags('管理后台 - 消息中心')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/notifications')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class InAppNotificationController {
  constructor(
    private readonly inAppNotificationService: InAppNotificationService,
  ) {}

  @Get()
  @RequirePermissions('notification:read')
  @ApiOperation({ summary: '消息中心列表' })
  @ApiQuery({ name: 'read', required: false, description: 'true/false' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '查询成功' })
  async list(
    @Query('read') read?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const filters: { read?: boolean } = {};
    if (read === 'true') filters.read = true;
    if (read === 'false') filters.read = false;

    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

    const result = await this.inAppNotificationService.query(filters, p, ps);
    return { code: 0, data: result };
  }

  @Get('unread-count')
  @RequirePermissions('notification:read')
  @ApiOperation({ summary: '未读通知数量' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async unreadCount() {
    const count = await this.inAppNotificationService.unreadCount();
    return { code: 0, data: { count } };
  }

  @Put('read-all')
  @RequirePermissions('notification:update')
  @ApiOperation({ summary: '标记全部通知已读' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async markAllRead() {
    const modifiedCount = await this.inAppNotificationService.markAllRead();
    return { code: 0, data: { modifiedCount } };
  }

  @Put(':id/read')
  @RequirePermissions('notification:update')
  @ApiOperation({ summary: '标记单条通知已读' })
  @ApiResponse({ status: 200, description: '操作成功' })
  async markRead(@Param('id') id: string) {
    const notification = await this.inAppNotificationService.markRead(id);
    if (!notification) {
      throw new NotFoundException('通知不存在');
    }
    return { code: 0, data: notification };
  }
}
