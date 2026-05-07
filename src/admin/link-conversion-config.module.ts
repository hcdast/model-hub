import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LinkConversionConfigService } from './link-conversion-config.service';

/**
 * 链接转换配置（Mongo）独立模块，避免 LinkConversionModule → AdminModule → TaskModule 循环依赖。
 */
@Module({
  imports: [DatabaseModule],
  providers: [LinkConversionConfigService],
  exports: [LinkConversionConfigService],
})
export class LinkConversionConfigModule {}
