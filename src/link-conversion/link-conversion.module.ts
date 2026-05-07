import { Module } from '@nestjs/common';
import { LinkConversionService } from './link-conversion.service';
import { LinkConversionConfigModule } from '../admin/link-conversion-config.module';

/**
 * 链接转换模块
 *
 * 提供三方链接转换功能，将任务输入中的三方资源链接转换为自有存储链接
 */
@Module({
  imports: [LinkConversionConfigModule],
  providers: [LinkConversionService],
  exports: [LinkConversionService],
})
export class LinkConversionModule {}
