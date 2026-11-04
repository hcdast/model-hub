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
import { mediaProbeStatus } from '../metadata/media-input-validator.service';

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
  // Capture once: a later build on disk must not relabel an already running process.
  private readonly backendBuild = this.readBackendBuild();
  constructor(@InjectConnection() private readonly mongoose: Connection) {}

  @Get()
  @RequirePermissions('system:read')
  @ApiOperation({
    summary: '只读运行信息',
    description: '进程角色、版本、存活时间、依赖状态与运维外链（不含密钥）',
  })
  @ApiResponse({ status: 200, description: '成功' })
  async getInfo() {
    const appVersion = this.readPackageVersion();
    const processType = safeProcessTypeLabel();
    const uptimeSec = Math.floor(process.uptime());

    const opsPrometheus = process.env.OPS_PROMETHEUS_URL?.trim() || '';
    const opsGrafana = process.env.OPS_GRAFANA_URL?.trim() || '';
    const opsDocs = process.env.OPS_DOCUMENTATION_URL?.trim() || '';
    const [transactionsSupported, mediaValidation] = await Promise.all([
      this.mongoose.db?.admin().command({ hello: 1, maxTimeMS: 2000 })
        .then(result => !!(result.setName || result.msg === 'isdbgrid') && result.logicalSessionTimeoutMinutes != null)
        .catch(() => null) ?? Promise.resolve(null),
      mediaProbeStatus(),
    ]);

    return {
      code: 0,
      data: {
        appVersion,
        backendBuild: this.backendBuild,
        frontendBuild: this.readFrontendBuild(),
        timezone: 'UTC',
        processType,
        nodeVersion: process.version,
        uptimeSec,
        mongodb: { connected: this.mongoose.readyState === 1, transactionsSupported },
        mediaValidation,
        opsLinks: {
          prometheus: opsPrometheus || null,
          grafana: opsGrafana || null,
          documentation: opsDocs || null,
        },
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private readFrontendBuild() {
    try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'dashboard', 'dist', 'build-info.json'), 'utf8')); }
    catch { return null; }
  }

  private readBackendBuild() {
    let manifest: any = {};
    try { manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build-info.json'), 'utf8')); } catch {}
    return { ...manifest, id: process.env.BUILD_ID || manifest.id || null, commit: process.env.GIT_COMMIT || manifest.commit || null, builtAt: process.env.BUILD_TIME || manifest.builtAt || null };
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
