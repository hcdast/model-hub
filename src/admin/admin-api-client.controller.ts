import {
  BadRequestException,
  Body, Controller, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { ApiClientService } from '../api-client/api-client.service';

@ApiTags('管理后台 - API 客户端')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/api-clients')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminApiClientController {
  constructor(private readonly apiClients: ApiClientService) {}

  @Get()
  @RequirePermissions('api-client:read')
  @ApiOperation({ summary: 'API 客户端列表' })
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
  @ApiOperation({ summary: '创建 API 客户端（明文密钥仅返回一次）' })
  @ApiResponse({ status: 200, description: '成功' })
  async create(@Body() body: { name?: string }) {
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : undefined;
    const { clientId, plainKey, name: n } = await this.apiClients.createClient(name);
    return {
      code: 0,
      message: 'Save the apiKey now; it will not be shown again.',
      data: { clientId, name: n, apiKey: plainKey },
    };
  }

  @Patch(':clientId')
  @RequirePermissions('api-client:update')
  @ApiOperation({ summary: '启用 / 禁用 API 客户端' })
  @ApiResponse({ status: 200, description: '成功' })
  async patchEnabled(
    @Param('clientId') clientId: string,
    @Body() body: { enabled?: boolean },
  ) {
    this.apiClients.assertClientIdParam(clientId);
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    await this.apiClients.setEnabled(clientId, body.enabled);
    return { code: 0, message: 'Updated' };
  }

  @Post(':clientId/rotate')
  @RequirePermissions('api-client:update')
  @ApiOperation({ summary: '轮换密钥（新 apiKey 仅返回一次）' })
  @ApiResponse({ status: 200, description: '成功' })
  async rotate(@Param('clientId') clientId: string) {
    this.apiClients.assertClientIdParam(clientId);
    const { plainKey } = await this.apiClients.rotateSecret(clientId);
    return {
      code: 0,
      message: 'Save the apiKey now; it will not be shown again.',
      data: { clientId, apiKey: plainKey },
    };
  }

  @Patch(':clientId/priority')
  @RequirePermissions('api-client:update')
  @ApiOperation({ summary: '更新 API 客户端默认优先级' })
  @ApiResponse({ status: 200, description: '成功' })
  async updateDefaultPriority(
    @Param('clientId') clientId: string,
    @Body() body: { defaultPriority?: number },
  ) {
    this.apiClients.assertClientIdParam(clientId);
    if (body?.defaultPriority == null || typeof body.defaultPriority !== 'number') {
      throw new BadRequestException('defaultPriority must be a number');
    }
    await this.apiClients.updateDefaultPriority(clientId, body.defaultPriority);
    return { code: 0, message: 'Updated' };
  }
}
