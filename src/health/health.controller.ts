import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, MongooseHealthIndicator } from '@nestjs/terminus';

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
  ) {}

  @Get('liveness')
  @ApiOperation({ summary: '存活检查' })
  @ApiResponse({ status: 200, description: '服务存活' })
  liveness() {
    return { status: 'ok' };
  }

  @Get('readiness')
  @HealthCheck()
  @ApiOperation({ summary: '就绪检查', description: '检查 MongoDB 连接状态' })
  @ApiResponse({ status: 200, description: '服务就绪' })
  @ApiResponse({ status: 503, description: '服务未就绪' })
  readiness() {
    return this.health.check([() => this.mongoose.pingCheck('mongodb')]);
  }
}
