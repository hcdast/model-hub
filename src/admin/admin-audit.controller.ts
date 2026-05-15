import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { AuditAnchorPlugin } from './plugins/audit-anchor.plugin';

@ApiTags('管理后台 - 审计日志')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/audit-logs')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminAuditController {
  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly auditAnchorPlugin: AuditAnchorPlugin,
  ) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: '审计日志列表', description: '查询管理后台操作审计日志' })
  @ApiQuery({ name: 'action', required: false, description: '原始操作标识（如 AdminApiClient.create）' })
  @ApiQuery({ name: 'operationKind', required: false, description: '变动类型 create|update|delete|reset|read|credit|other' })
  @ApiQuery({ name: 'operator', required: false, description: '操作人' })
  @ApiQuery({ name: 'resource', required: false, description: '资源/功能模块类型' })
  @ApiQuery({ name: 'result', required: false, description: '结果 success | failure' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, description: '查询成功' })
  async listLogs(
    @Query('action') action?: string,
    @Query('operationKind') operationKind?: string,
    @Query('operator') operator?: string,
    @Query('resource') resource?: string,
    @Query('result') resultFilter?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ) {
    const result = await this.auditLogService.list(
      {
        action,
        operationKind,
        operator,
        resource,
        result: resultFilter as 'success' | 'failure' | undefined,
      },
      parseInt(page, 10) || 1,
      Math.min(100, parseInt(pageSize, 10) || 50),
    );
    return { code: 0, data: result };
  }

  @Get('resource-types')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: '审计资源类型列表', description: '获取所有已注册的审计资源类型' })
  @ApiResponse({ status: 200, description: '查询成功' })
  async getResourceTypes() {
    return { code: 0, data: this.auditAnchorPlugin.getAllResourceTypes() };
  }
}
