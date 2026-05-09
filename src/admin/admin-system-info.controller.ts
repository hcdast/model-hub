import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { resolveProcessType } from '../common/process-type.util';

function safeProcessTypeLabel(): string {
  try {
    return resolveProcessType(process.env.PROCESS_TYPE);
  } catch {
    const raw = (process.env.PROCESS_TYPE ?? '').trim();
    return raw || 'unset';
  }
}

@ApiTags('管理后台 - 系统信息')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/system-info')
@UseGuards(AdminJwtGuard, PermissionGuard)
export class AdminSystemInfoController {
  constructor(@InjectConnection() private readonly mongoose: Connection) {}

  @Get()
  @RequirePermissions('system:read')
  @ApiOperation({
    summary: '只读运行信息',
    description: '进程角色、版本、存活时间、依赖状态与运维外链（不含密钥）',
  })
  @ApiResponse({ status: 200, description: '成功' })
  getInfo() {
    const appVersion = this.readPackageVersion();
    const processType = safeProcessTypeLabel();
    const uptimeSec = Math.floor(process.uptime());

    const opsPrometheus = process.env.OPS_PROMETHEUS_URL?.trim() || '';
    const opsGrafana = process.env.OPS_GRAFANA_URL?.trim() || '';
    const opsDocs = process.env.OPS_DOCUMENTATION_URL?.trim() || '';

    return {
      code: 0,
      data: {
        appVersion,
        processType,
        nodeVersion: process.version,
        uptimeSec,
        mongodb: { connected: this.mongoose.readyState === 1 },
        opsLinks: {
          prometheus: opsPrometheus || null,
          grafana: opsGrafana || null,
          documentation: opsDocs || null,
        },
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private readPackageVersion(): string {
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const raw = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(raw) as { version?: string };
      return pkg.version || '0.0.0';
    } catch {
      return 'unknown';
    }
  }
}
