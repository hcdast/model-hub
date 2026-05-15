import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RolesGuard } from './guards/roles.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { Roles } from './decorators/roles.decorator';
import { CircuitBreakerService } from '../provider-health/circuit-breaker.service';
import { CircuitBreakerConfigService } from '../provider-health/circuit-breaker-config.service';
import { HealthMetricsCollector } from '../provider-health/health-metrics-collector.service';
import { CircuitState } from '../provider-health/interfaces/circuit-breaker-state.interface';
import {
  CircuitBreakerOverrideDto,
  UpdateCircuitBreakerConfigDto,
} from './dto/provider-health.dto';

/**
 * 供应商健康度管理 API
 * 提供健康概览、详细信息、历史指标、熔断器手动覆盖和配置管理
 */
@ApiTags('管理后台 - 供应商健康度')
@ApiBearerAuth('AdminJwt')
@Controller('api/v1/admin/provider-health')
@UseGuards(AdminJwtGuard, PermissionGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ProviderHealthController {
  private readonly logger = new Logger(ProviderHealthController.name);

  constructor(
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly configService: CircuitBreakerConfigService,
    private readonly metricsCollector: HealthMetricsCollector,
  ) {}

  /**
   * 获取所有供应商的健康概览
   */
  @Get('overview')
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '获取所有供应商的健康概览' })
  @ApiResponse({ status: 200, description: '成功返回健康概览列表' })
  async getOverview() {
    // 获取所有 Provider 的健康指标
    const allMetrics = await this.metricsCollector.getAllMetrics();
    // 获取所有 Provider 的熔断状态
    const allStates = await this.circuitBreakerService.getAllStates();

    const items = allMetrics.map((metrics) => {
      const state = allStates.get(metrics.provider);
      return {
        provider: metrics.provider,
        circuitState: state?.state ?? CircuitState.CLOSED,
        successRate: metrics.successRate,
        avgLatencyMs: metrics.avgLatencyMs,
        errorRate: metrics.errorRate,
        sampleCount: metrics.sampleCount,
        lastTransitionAt: state?.lastTransitionAt ?? new Date().toISOString(),
        hasManualOverride: state?.manualOverride !== null && state?.manualOverride !== undefined,
      };
    });

    return { code: 0, data: { items } };
  }

  /**
   * 获取单个供应商的详细健康信息
   */
  @Get(':provider')
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '获取单个供应商的详细健康信息' })
  @ApiParam({ name: 'provider', description: '供应商标识（与路由中的 provider 名称一致）' })
  @ApiResponse({ status: 200, description: '成功返回供应商详细健康信息' })
  async getProviderHealth(@Param('provider') provider: string) {
    const decodedProvider = decodeURIComponent(provider);

    // 获取健康指标
    const metrics = await this.metricsCollector.getMetrics(decodedProvider);
    // 获取完整熔断器状态
    const state = await this.circuitBreakerService.getFullState(decodedProvider);
    // 获取熔断器配置
    const config = await this.configService.getConfig(decodedProvider);

    return {
      code: 0,
      data: {
        provider: decodedProvider,
        circuitState: state.state,
        metrics: {
          successRate: metrics.successRate,
          errorRate: metrics.errorRate,
          avgLatencyMs: metrics.avgLatencyMs,
          sampleCount: metrics.sampleCount,
          windowDurationMs: metrics.windowDurationMs,
          computedAt: metrics.computedAt,
        },
        circuitBreaker: {
          state: state.state,
          openedAt: state.openedAt,
          lastTransitionAt: state.lastTransitionAt,
          consecutiveFailures: state.consecutiveFailures,
          probeSuccesses: state.probeSuccesses,
          manualOverride: state.manualOverride,
        },
        config,
      },
    };
  }

  /**
   * 获取供应商的历史指标时间序列
   * 从 Redis 滑动窗口中获取指定时间范围内的数据点，按时间分组返回
   */
  @Get(':provider/history')
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '获取供应商的历史指标时间序列' })
  @ApiParam({ name: 'provider', description: '供应商标识（与路由中的 provider 名称一致）' })
  @ApiQuery({ name: 'hours', required: false, description: '查询时间范围（小时），默认 1' })
  @ApiResponse({ status: 200, description: '成功返回历史指标时间序列' })
  async getHistory(
    @Param('provider') provider: string,
    @Query('hours') hours?: string,
  ) {
    const decodedProvider = decodeURIComponent(provider);
    const queryHours = hours ? parseInt(hours, 10) : 1;

    // 校验 hours 参数
    if (isNaN(queryHours) || queryHours < 1 || queryHours > 24) {
      throw new BadRequestException('hours 参数必须为 1-24 之间的整数');
    }

    // 获取当前窗口内的健康指标作为最新数据点
    const currentMetrics = await this.metricsCollector.getMetrics(decodedProvider);

    // 返回当前窗口内的数据点（简化实现：返回当前快照作为时间序列的最新点）
    const dataPoints = [
      {
        timestamp: currentMetrics.computedAt,
        successRate: currentMetrics.successRate,
        errorRate: currentMetrics.errorRate,
        avgLatencyMs: currentMetrics.avgLatencyMs,
        sampleCount: currentMetrics.sampleCount,
      },
    ];

    return {
      code: 0,
      data: {
        provider: decodedProvider,
        hours: queryHours,
        dataPoints,
      },
    };
  }

  /**
   * 手动覆盖熔断器状态
   * 仅允许 admin 和 operator 角色操作
   */
  @Post(':provider/circuit-breaker/override')
  @RequirePermissions('provider:update')
  @Roles('admin', 'operator')
  @ApiOperation({ summary: '手动覆盖熔断器状态' })
  @ApiParam({ name: 'provider', description: '供应商标识（与路由中的 provider 名称一致）' })
  @ApiResponse({ status: 200, description: '覆盖成功' })
  @ApiResponse({ status: 400, description: '参数错误' })
  async overrideCircuitBreaker(
    @Param('provider') provider: string,
    @Body() dto: CircuitBreakerOverrideDto,
    @Req() req: Request,
  ) {
    const decodedProvider = decodeURIComponent(provider);
    const admin = (req as any).adminUser as { username?: string };
    const operator = admin?.username || 'unknown';

    // 校验状态值：仅允许 OPEN 或 CLOSED
    if (dto.state !== CircuitState.OPEN && dto.state !== CircuitState.CLOSED) {
      throw new BadRequestException('仅允许设置为 OPEN 或 CLOSED');
    }

    await this.circuitBreakerService.manualOverride(
      decodedProvider,
      dto.state,
      operator,
    );

    this.logger.log(
      `Provider ${decodedProvider} 熔断器被手动覆盖为 ${dto.state}，操作人: ${operator}`,
    );

    return {
      code: 0,
      data: {
        provider: decodedProvider,
        state: dto.state,
        operator,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * 清除手动覆盖，恢复自动熔断
   * 仅允许 admin 和 operator 角色操作
   */
  @Delete(':provider/circuit-breaker/override')
  @RequirePermissions('provider:update')
  @Roles('admin', 'operator')
  @ApiOperation({ summary: '清除熔断器手动覆盖' })
  @ApiParam({ name: 'provider', description: '供应商标识（与路由中的 provider 名称一致）' })
  @ApiResponse({ status: 200, description: '清除成功' })
  async clearOverride(@Param('provider') provider: string) {
    const decodedProvider = decodeURIComponent(provider);

    await this.circuitBreakerService.clearOverride(decodedProvider);

    this.logger.log(
      `Provider ${decodedProvider} 手动覆盖已清除，恢复自动熔断`,
    );

    return {
      code: 0,
      data: {
        provider: decodedProvider,
        message: '手动覆盖已清除，恢复自动熔断',
      },
    };
  }

  /**
   * 更新供应商的熔断器配置
   * 仅允许 admin 角色操作
   */
  @Put(':provider/circuit-breaker/config')
  @RequirePermissions('provider:update')
  @Roles('admin')
  @ApiOperation({ summary: '更新供应商的熔断器配置' })
  @ApiParam({ name: 'provider', description: '供应商标识（与路由中的 provider 名称一致）' })
  @ApiResponse({ status: 200, description: '配置更新成功' })
  @ApiResponse({ status: 400, description: '配置校验失败' })
  async updateConfig(
    @Param('provider') provider: string,
    @Body() dto: UpdateCircuitBreakerConfigDto,
  ) {
    const decodedProvider = decodeURIComponent(provider);

    // 将 DTO 中的 snake_case 字段转换为 camelCase 传给 ConfigService
    const configUpdate: Record<string, number | undefined> = {};
    if (dto.error_rate_threshold !== undefined) {
      configUpdate['errorRateThreshold'] = dto.error_rate_threshold;
    }
    if (dto.consecutive_failure_threshold !== undefined) {
      configUpdate['consecutiveFailureThreshold'] = dto.consecutive_failure_threshold;
    }
    if (dto.cooldown_duration_ms !== undefined) {
      configUpdate['cooldownDurationMs'] = dto.cooldown_duration_ms;
    }
    if (dto.probe_request_count !== undefined) {
      configUpdate['probeRequestCount'] = dto.probe_request_count;
    }
    if (dto.sliding_window_duration_ms !== undefined) {
      configUpdate['slidingWindowDurationMs'] = dto.sliding_window_duration_ms;
    }
    if (dto.min_sample_count !== undefined) {
      configUpdate['minSampleCount'] = dto.min_sample_count;
    }

    // 使用 ConfigService 的校验和更新逻辑
    try {
      await this.configService.updateConfig(decodedProvider, configUpdate);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    return {
      code: 0,
      data: {
        provider: decodedProvider,
        message: '熔断器配置更新成功',
      },
    };
  }

  /**
   * 获取供应商的熔断器配置
   */
  @Get(':provider/circuit-breaker/config')
  @RequirePermissions('provider:read')
  @ApiOperation({ summary: '获取供应商的熔断器配置' })
  @ApiParam({ name: 'provider', description: '供应商标识（与路由中的 provider 名称一致）' })
  @ApiResponse({ status: 200, description: '成功返回熔断器配置' })
  async getConfig(@Param('provider') provider: string) {
    const decodedProvider = decodeURIComponent(provider);
    const config = await this.configService.getConfig(decodedProvider);

    return {
      code: 0,
      data: {
        provider: decodedProvider,
        config: {
          error_rate_threshold: config.errorRateThreshold,
          consecutive_failure_threshold: config.consecutiveFailureThreshold,
          cooldown_duration_ms: config.cooldownDurationMs,
          probe_request_count: config.probeRequestCount,
          sliding_window_duration_ms: config.slidingWindowDurationMs,
          min_sample_count: config.minSampleCount,
        },
      },
    };
  }
}
