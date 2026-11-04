import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckError, HealthCheckService, MongooseHealthIndicator } from '@nestjs/terminus';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { mediaProbeStatus } from '../metadata/media-input-validator.service';

@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  @Get('liveness')
  @ApiOperation({ summary: '存活检查' })
  @ApiResponse({ status: 200, description: '服务存活' })
  liveness() {
    return { status: 'ok' };
  }

  @Get('readiness')
  @HealthCheck()
  @ApiOperation({ summary: '就绪检查', description: '检查 MongoDB 连接、资金事务能力及媒体检测器' })
  @ApiResponse({ status: 200, description: '服务就绪' })
  @ApiResponse({ status: 503, description: '服务未就绪' })
  readiness() {
    return this.health.check([
      () => this.mongoose.pingCheck('mongodb'),
      async () => {
        const hello = await this.connection.db!.admin().command({ hello: 1, maxTimeMS: 2000 });
        if (!(hello.setName || hello.msg === 'isdbgrid') || hello.logicalSessionTimeoutMinutes == null) {
          throw new HealthCheckError('Money transactions require a replica set or sharded cluster', { moneyTransactions: { status: 'down', reason: 'replica_set_required' } });
        }
        return { moneyTransactions: { status: 'up' as const } };
      },
      async () => {
        if (!(await mediaProbeStatus()).ready) throw new HealthCheckError('Media probe unavailable', { mediaValidation: { status: 'down' } });
        return { mediaValidation: { status: 'up' as const } };
      },
    ]);
  }
}
