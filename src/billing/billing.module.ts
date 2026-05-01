import { Global, Module, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from '../database/database.module';
import { PricingService } from './pricing.service';
import { BillingService } from './billing.service';
import { WalletService } from './wallet.service';
import { BillingAdapter } from './billing.adapter';

/**
 * 计费模块 —— 提供完整的 Pricing → Billing → Wallet 三层计费能力。
 *
 * 使用 @Global() 装饰器，使 BillingAdapter 等服务在所有模块中可用，
 * 无需在 TaskModule、PollingModule 等模块中显式导入。
 *
 * 需要在以下进程中加载：
 * - api：TaskService.createTask() 调用 BillingAdapter.initBilling()
 * - worker：FeatureQueueProcessor 同步任务完成时触发结算
 * - scheduler：PollingService 任务状态转换时触发结算/退款
 * - admin-server：管理后台计费查询 API
 */
@Global()
@Module({
  imports: [
    // 获取 Mongoose Schema Models（BillingRecord, Wallet, WalletTransaction, ModelConfig, ApiClient 等）
    DatabaseModule,
    // WalletService 依赖 EventEmitter2 发射 wallet.low_balance 事件
    EventEmitterModule.forRoot(),
  ],
  providers: [PricingService, BillingService, WalletService, BillingAdapter],
  exports: [BillingAdapter, PricingService, BillingService, WalletService],
})
export class BillingModule implements OnModuleInit {
  private readonly logger = new Logger(BillingModule.name);

  /**
   * 模块初始化回调 —— 记录计费模块加载完成日志
   */
  onModuleInit() {
    this.logger.log('计费模块（BillingModule）初始化完成，Pricing / Billing / Wallet 服务已就绪');
  }
}
