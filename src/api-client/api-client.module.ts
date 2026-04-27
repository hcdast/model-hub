import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ApiClientService } from './api-client.service';

@Module({
  imports: [DatabaseModule],
  providers: [ApiClientService],
  exports: [ApiClientService],
})
export class ApiClientModule {}
