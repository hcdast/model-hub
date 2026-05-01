import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ApiClient,
  ApiClientDocument,
} from '../database/schemas/api-client.schema';
import { PricingService } from './pricing.service';
import { BillingService } from './billing.service';
import { WalletService } from './wallet.service';
import {
  BillingPolicy,
  BillingStatus,
  UsageType,
} from './interfaces/billing.interface';
import {
  BillingInitContext,
  BillingSettleContext,
  BillingRefundContext,
} from './interfaces/billing-context.interface';
import { InsufficientBalanceException } from './exceptions/insufficient-balance.exception';

/**
 * 计费适配器 —— 统一计费入口，按 API Client 的 billingPolicy 动态分发计费行为。
 *
 * 核心职责：
 * - resolvePolicy：根据 clientId 查询 API Client 的计费策略
 * - initBilling：任务创建时初始化计费（预估 → 创建记录 → 预扣费）
 * - settle：任务成功时结算（解冻 → 扣费 → 更新记录）
 * - refund：任务失败时退款（解冻 → 更新记录）
 *
 * 策略行为：
 * - exempt：跳过所有计费逻辑，零副作用
 * - external：记录用量但不执行 Wallet 扣费
 * - internal：完整的 Pricing → Billing → Wallet 计费链路
 */
@Injectable()
export class BillingAdapter {
  private readonly logger = new Logger(BillingAdapter.name);

  constructor(
    @InjectModel(ApiClient.name)
    private readonly apiClientModel: Model<ApiClientDocument>,
    private readonly pricingService: PricingService,
    private readonly billingService: BillingService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * 查询 API Client 的计费策略
   *
   * 从 api_clients 集合查询 billingPolicy 字段。
   * 未找到客户端或未配置策略时默认返回 'internal'，确保向后兼容。
   */
  async resolvePolicy(clientId: string): Promise<BillingPolicy> {
    const client = await this.apiClientModel
      .findOne({ clientId })
      .select('billingPolicy')
      .lean();

    if (!client || !client.billingPolicy) {
      this.logger.warn(
        `客户端 [${clientId}] 未找到或未配置 billingPolicy，使用默认策略 internal`,
      );
      return BillingPolicy.INTERNAL;
    }

    return client.billingPolicy as BillingPolicy;
  }

  /**
   * 计费初始化 —— 任务创建时调用
   *
   * 流程：
   * 1. 查询 API Client 的 billingPolicy
   * 2. exempt → 直接返回，零副作用
   * 3. external/internal → 调用 PricingService.estimate() 获取预估
   * 4. external/internal → 调用 BillingService.createRecord() 创建记录
   * 5. internal + count/duration → 调用 WalletService.freeze() 预扣费
   *    - freeze 失败 → 抛出 InsufficientBalanceException
   *    - freeze 成功 → 调用 BillingService.markPreDeducted()
   * 6. internal + token → 不预扣费，记录已创建（状态为 estimated）
   * 7. external → 不执行任何钱包操作，记录已创建
   */
  async initBilling(context: BillingInitContext): Promise<void> {
    const policy = await this.resolvePolicy(context.clientId);

    this.logger.log(
      `计费初始化：taskId=${context.taskId}, clientId=${context.clientId}, ` +
      `model=${context.model}, billingPolicy=${policy}`,
    );

    // exempt 策略：跳过所有计费逻辑
    if (policy === BillingPolicy.EXEMPT) {
      this.logger.log(`计费跳过（exempt）：taskId=${context.taskId}`);
      return;
    }

    // 获取价格预估
    const estimate = await this.pricingService.estimate(
      context.model,
      context.input,
    );

    // 创建计费记录
    await this.billingService.createRecord({
      taskId: context.taskId,
      clientId: context.clientId,
      model: context.model,
      provider: context.provider,
      estimate,
      billingPolicy: policy,
    });

    // external 策略：仅记录用量，不执行钱包操作
    if (policy === BillingPolicy.EXTERNAL) {
      this.logger.log(
        `计费记录已创建（external，不扣费）：taskId=${context.taskId}`,
      );
      return;
    }

    // internal 策略：根据 usageType 决定是否预扣费
    if (
      estimate.usageType === UsageType.COUNT ||
      estimate.usageType === UsageType.DURATION
    ) {
      // count/duration 类型：预扣费
      const frozen = await this.walletService.freeze(
        context.clientId,
        estimate.estimatedCost,
        context.taskId,
      );

      if (!frozen) {
        this.logger.warn(
          `预扣费失败（余额不足）：taskId=${context.taskId}, ` +
          `clientId=${context.clientId}, estimatedCost=${estimate.estimatedCost}`,
        );
        throw new InsufficientBalanceException(
          context.clientId,
          estimate.estimatedCost,
        );
      }

      // 预扣费成功，标记记录为 pre_deducted
      await this.billingService.markPreDeducted(context.taskId);
      this.logger.log(
        `预扣费成功：taskId=${context.taskId}, estimatedCost=${estimate.estimatedCost}`,
      );
    } else {
      // token 类型：不预扣费，记录保持 estimated 状态
      this.logger.log(
        `计费记录已创建（internal/token，不预扣费）：taskId=${context.taskId}`,
      );
    }
  }

  /**
   * 计费结算 —— 任务成功完成时调用
   *
   * 流程：
   * 1. 查询 BillingRecord，不存在则返回（exempt 任务无记录）
   * 2. 计算 actualCost = unitPrice × actualUsage
   * 3. billingPolicy=internal + pre_deducted → unfreeze(estimatedCost) + debit(actualCost)
   * 4. billingPolicy=internal + estimated(token) → 直接 debit(actualCost)
   * 5. debit 失败 → markFailed + warning 日志（不阻断）
   * 6. 成功 → billingService.settle(taskId, actualUsage, actualCost)
   * 7. billingPolicy=external → 仅调用 billingService.settle() 更新记录（不扣费）
   */
  async settle(context: BillingSettleContext): Promise<void> {
    const record = await this.billingService.getRecord(context.taskId);

    // exempt 任务无记录，直接返回
    if (!record) {
      this.logger.log(`结算跳过（无记录）：taskId=${context.taskId}`);
      return;
    }

    const actualCost =
      record.unitPrice * context.actualUsage.usageValue;

    this.logger.log(
      `计费结算开始：taskId=${context.taskId}, billingPolicy=${record.billingPolicy}, ` +
      `status=${record.status}, actualUsage=${context.actualUsage.usageValue}, ` +
      `actualCost=${actualCost}`,
    );

    if (record.billingPolicy === BillingPolicy.INTERNAL) {
      if (record.status === BillingStatus.PRE_DEDUCTED) {
        // 预扣费任务：先解冻预扣金额，再扣实际费用
        await this.walletService.unfreeze(
          record.clientId,
          record.estimatedCost,
          context.taskId,
        );

        const debitOk = await this.walletService.debit(
          record.clientId,
          actualCost,
          context.taskId,
        );

        if (!debitOk) {
          this.logger.warn(
            `结算扣费失败：taskId=${context.taskId}, clientId=${record.clientId}, ` +
            `actualCost=${actualCost}`,
          );
          await this.billingService.markFailed(context.taskId, 'debit_failed');
          return;
        }
      } else {
        // 后扣费任务（token 类型，状态为 estimated）：直接扣费
        const debitOk = await this.walletService.debit(
          record.clientId,
          actualCost,
          context.taskId,
        );

        if (!debitOk) {
          this.logger.warn(
            `后扣费失败：taskId=${context.taskId}, clientId=${record.clientId}, ` +
            `actualCost=${actualCost}`,
          );
          await this.billingService.markFailed(context.taskId, 'debit_failed');
          return;
        }
      }
    }

    // internal 和 external 都更新记录为 settled
    await this.billingService.settle(
      context.taskId,
      context.actualUsage.usageValue,
      actualCost,
    );

    this.logger.log(`计费结算完成：taskId=${context.taskId}, actualCost=${actualCost}`);
  }

  /**
   * 计费退款 —— 任务失败或超时时调用
   *
   * 流程：
   * 1. 查询 BillingRecord，不存在则返回（exempt 任务无记录）
   * 2. billingPolicy=internal + pre_deducted → walletService.unfreeze()（指数退避重试 3 次）
   * 3. 调用 billingService.markRefunded()
   * 4. billingPolicy=external → 仅更新记录状态
   * 5. 非 pre_deducted 状态（如 token 类型）→ 仅更新记录状态，不涉及钱包
   */
  async refund(context: BillingRefundContext): Promise<void> {
    const record = await this.billingService.getRecord(context.taskId);

    // exempt 任务无记录，直接返回
    if (!record) {
      this.logger.log(`退款跳过（无记录）：taskId=${context.taskId}`);
      return;
    }

    this.logger.log(
      `计费退款开始：taskId=${context.taskId}, billingPolicy=${record.billingPolicy}, ` +
      `status=${record.status}, reason=${context.reason}`,
    );

    // internal + pre_deducted：需要解冻预扣金额
    if (
      record.billingPolicy === BillingPolicy.INTERNAL &&
      record.status === BillingStatus.PRE_DEDUCTED
    ) {
      await this.retryUnfreeze(
        record.clientId,
        record.estimatedCost,
        context.taskId,
      );
    }

    // 更新记录状态为 refunded（internal 和 external 都更新）
    await this.billingService.markRefunded(context.taskId);

    this.logger.log(`计费退款完成：taskId=${context.taskId}`);
  }

  /**
   * 指数退避重试解冻 —— 退款时使用
   *
   * 最多重试 3 次，每次等待时间翻倍（100ms → 200ms → 400ms）。
   * 全部失败后记录 error 日志，不抛出异常（不阻断任务状态转换）。
   */
  private async retryUnfreeze(
    clientId: string,
    amount: number,
    taskId: string,
    maxRetries = 3,
  ): Promise<void> {
    const baseDelay = 100; // 基础延迟 100ms

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.walletService.unfreeze(clientId, amount, taskId);
        this.logger.log(
          `解冻成功（第 ${attempt} 次尝试）：clientId=${clientId}, ` +
          `amount=${amount}, taskId=${taskId}`,
        );
        return;
      } catch (err: any) {
        this.logger.warn(
          `解冻失败（第 ${attempt}/${maxRetries} 次）：clientId=${clientId}, ` +
          `amount=${amount}, taskId=${taskId}, error=${err.message}`,
        );

        if (attempt < maxRetries) {
          // 指数退避等待
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    // 全部重试失败
    this.logger.error(
      `解冻重试全部失败：clientId=${clientId}, amount=${amount}, ` +
      `taskId=${taskId}，需人工介入`,
    );
  }

  /**
   * 延迟工具方法 —— 用于指数退避重试
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
