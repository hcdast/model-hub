import { Controller, Get, Put, Param, Query, UseGuards, ValidationPipe, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PortalUserId } from './decorators/portal-user.decorator';
import { PortalJwtGuard } from './guards/portal-jwt.guard';
import { PortalNotificationService } from './portal-notification.service';

export class PortalNotificationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  pageSize = 8;

  @IsOptional() @IsIn(['true', 'false'])
  unreadOnly?: string;
}

@ApiTags('门户通知')
@ApiBearerAuth()
@Controller('v1/notifications')
@UseGuards(PortalJwtGuard)
export class PortalNotificationController {
  constructor(private readonly notifications: PortalNotificationService) {}

  @Get()
  @ApiOperation({ summary: '当前用户的工作流运行通知' })
  list(@PortalUserId() userId: string,
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) query: PortalNotificationQuery) {
    return this.notifications.list(userId, query.page, query.pageSize, query.unreadOnly === 'true');
  }

  @Get('unread-count')
  unreadCount(@PortalUserId() userId: string) {
    return this.notifications.unreadCount(userId).then(count => ({ count }));
  }

  @Put('read-all')
  markAllRead(@PortalUserId() userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Put(':id/read')
  markRead(@PortalUserId() userId: string, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.notifications.markRead(userId, id);
  }
}
