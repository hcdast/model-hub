import { Module, Global, Logger } from '@nestjs/common';
import { loadAppConfig } from './nacos-config.loader';

export const APP_CONFIG = 'APP_CONFIG';

/**
 * 与 Akool 现有服务对齐（management-backend SharedModule 模式）：
 * - Nacos 开启时整包加载 JSON，注入为 APP_CONFIG
 * - Nacos 关闭时读本地 config/${NODE_ENV}.json
 * - 业务代码通过 @Inject(APP_CONFIG) 获取配置对象
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: async () => {
        const logger = new Logger('ConfigModule');
        try {
          const config = await loadAppConfig();
          logger.log('App config loaded successfully');
          return config;
        } catch (err: any) {
          logger.error(`Failed to load config: ${err.message}`);
          process.exit(1);
        }
      },
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
