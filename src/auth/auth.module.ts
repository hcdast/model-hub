import { Module } from '@nestjs/common';
import { ApiClientModule } from '../api-client/api-client.module';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [ApiClientModule],
  providers: [ApiKeyGuard],
  /** 导出 ApiClientModule，便于 TaskModule 等在使用 ApiKeyGuard 时解析 ApiClientService */
  exports: [ApiKeyGuard, ApiClientModule],
})
export class AuthModule {}
