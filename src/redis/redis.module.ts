import { Module, Global, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/interfaces/config.interface';
import { REDIS_CLIENT } from './redis.constants';
import { RedisLockService } from './redis-lock.service';
import { RateLimiterService } from './rate-limiter.service';

export { REDIS_CLIENT };

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('RedisModule');
        const client = new Redis({
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password || undefined,
          db: config.redis.db || 0,
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          retryStrategy: (times: number) => Math.min(times * 200, 5000),
        });
        client.on('connect', () => logger.log('Redis connected'));
        client.on('error', (err) =>
          logger.error(`Redis error: ${err.message}`),
        );
        return client;
      },
    },
    RedisLockService,
    RateLimiterService,
  ],
  exports: [REDIS_CLIENT, RedisLockService, RateLimiterService],
})
export class RedisModule {}
