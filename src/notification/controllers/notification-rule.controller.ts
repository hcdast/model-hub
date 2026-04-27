import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
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
import { NotificationService } from '../services/notification.service';

@ApiTags('管理后台 - 通知规则')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/notification-rules')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class NotificationRuleController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @RequirePermissions('notification:read')
  @ApiOperation({ summary: '通知规则列表' })
  @ApiQuery({ name: 'enabled', required: false, description: 'true/false' })
  @ApiQuery({ name: 'channelType', required: false })
  @ApiResponse({ status: 200, description: '查询成功' })
  async list(
    @Query('enabled') enabled?: string,
    @Query('channelType') channelType?: string,
  ) {
    const filters: { enabled?: boolean; channelType?: string } = {};
    if (enabled === 'true') filters.enabled = true;
    if (enabled === 'false') filters.enabled = false;
    if (channelType) filters.channelType = channelType;

    const items = await this.notificationService.listRules(filters);
    return { code: 0, data: { items } };
  }

  @Get(':id')
  @RequirePermissions('notification:read')
  @ApiOperation({ summary: '通知规则详情' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getById(@Param('id') id: string) {
    const rule = await this.notificationService.getRuleById(id);
    if (!rule) {
      throw new NotFoundException('通知规则不存在');
    }
    return { code: 0, data: rule };
  }

  @Post()
  @RequirePermissions('notification:create')
  @ApiOperation({ summary: '创建通知规则' })
  @ApiResponse({ status: 201, description: '创建成功' })
  async create(@Body() body: Record<string, any>) {
    try {
      const rule = await this.notificationService.createRule(body);
      return { code: 0, data: rule };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Put(':id')
  @RequirePermissions('notification:update')
  @ApiOperation({ summary: '更新通知规则' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async update(@Param('id') id: string, @Body() body: Record<string, any>) {
    try {
      const rule = await this.notificationService.updateRule(id, body);
      if (!rule) {
        throw new NotFoundException('通知规则不存在');
      }
      return { code: 0, data: rule };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }

  @Delete(':id')
  @RequirePermissions('notification:delete')
  @ApiOperation({ summary: '删除通知规则' })
  @ApiResponse({ status: 200, description: '删除成功' })
  async delete(@Param('id') id: string) {
    await this.notificationService.deleteRule(id);
    return { code: 0, data: null };
  }
}
