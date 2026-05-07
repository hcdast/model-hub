import { Controller, Get, Put, Body, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { LinkConversionConfigService } from './link-conversion-config.service';
import { AuditLogService } from './audit-log.service';
import { LINK_CONVERSION_CONFIG_CACHE_MS } from './link-conversion-config.types';

@ApiTags('管理后台 - 第三方链接转换配置')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/link-conversion-config')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminLinkConversionConfigController {
  constructor(
    private readonly configService: LinkConversionConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions('link-conversion:read')
  @ApiOperation({
    summary: '获取链接转换配置（合并默认值；运行时带 60s 进程内缓存）',
  })
  async get(@Req() req: Request) {
    const bypass =
      String((req.query as Record<string, string>)?.fresh || '') === '1';
    const { config, revision, updatedAt } =
      await this.configService.getForAdmin({ bypassCache: bypass });
    return {
      code: 0,
      data: {
        config,
        revision,
        updated_at: updatedAt,
        cache_ttl_ms: LINK_CONVERSION_CONFIG_CACHE_MS,
      },
    };
  }

  @Put()
  @RequirePermissions('link-conversion:update')
  @ApiOperation({ summary: '全量更新链接转换配置' })
  async put(@Body() body: Record<string, unknown>, @Req() req: Request) {
    const admin = (req as any).adminUser as { username?: string };
    const operator = admin?.username || 'unknown';
    const { revision } = await this.configService.replaceConfig(body, operator);
    await this.auditLog.log(
      'link_conversion_config.replace',
      operator,
      { revision },
      req.ip,
    );
    return { code: 0, data: { revision } };
  }
}
