import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ApiClient,
  ApiClientDocument,
} from '../database/schemas/api-client.schema';
import {
  PortalApiKey,
  PortalApiKeyDocument,
} from '../database/schemas/portal-api-key.schema';
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
import { computeActualUsageValue } from './actual-usage.util';

/**
 * 计费适配器 —— 统一计费入口，按 API Client 的 billingPolicy 动态分发计费行为。
 *
 * 核心职责：
 * - resolvePolicy：根据 apiKey 查询 API Client 的计费策略
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
    @InjectModel(PortalApiKey.name)
    private readonly portalApiKeyModel: Model<PortalApiKeyDocument>,
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
  async resolvePolicy(apiKey: string): Promise<BillingPolicy> {
    const client = await this.apiClientModel
      .findOne({ apiKey })
      .select('billingPolicy')
      .lean();

    if (client?.billingPolicy) {
      return client.billingPolicy as BillingPolicy;
    }

    const portalKey = await this.portalApiKeyModel
      .findOne({ billingKey: apiKey, enabled: true })
      .select('billingPolicy')
      .lean();
    if (portalKey?.billingPolicy) {
      return portalKey.billingPolicy as BillingPolicy;
    }

    throw new Error(`No billing policy found for client ${apiKey}`);
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
    const rejected = await this.billingService.transaction(async () => {
      try { await this.initBillingInTransaction(context); }
      catch (error) { if (error instanceof InsufficientBalanceException) return error; throw error; }
    });
    if (rejected) throw rejected;
  }

  private async initBillingInTransaction(context: BillingInitContext): Promise<void> {
    const existing = await this.billingService.getRecord(context.taskId);
    if (existing) {
      if (existing.apiKey !== context.apiKey || existing.model !== context.model || existing.provider !== context.provider) throw new Error('Conflicting billing task identity');
      if (existing.status === BillingStatus.FAILED) throw new Error('Billing initialization previously failed');
      return;
    }
    const policy = await this.resolvePolicy(context.apiKey);

    this.logger.log(
      `计费初始化：taskId=${context.taskId}, apiKey=${context.apiKey}, ` +
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
      context.modelConfig,
    );

    if (context.maxCharge !== undefined && (!Number.isFinite(context.maxCharge) || context.maxCharge < 0 || estimate.estimatedCost > context.maxCharge)) {
      throw new Error('Task estimate exceeds authorized charge');
    }

    // 创建计费记录
    await this.billingService.createRecord({
      taskId: context.taskId,
      apiKey: context.apiKey,
      model: context.model,
      provider: context.provider,
      estimate,
      pricingSnapshot: context.modelConfig ? { revision: context.modelConfig.revision || 0, unit_price_map: JSON.parse(JSON.stringify(context.modelConfig.unit_price_map || {})), pricing: context.modelConfig.pricing } : undefined,
      billingPolicy: policy,
      ...(context.modelConfig?.pricing?.usage_measure ? { usageMeasure: context.modelConfig.pricing.usage_measure } : {}),
      ...(context.maxCharge !== undefined ? { maxCharge: context.maxCharge } : {}),
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
        context.apiKey,
        estimate.estimatedCost,
        context.taskId,
      );

      if (!frozen) {
        // No task will be created after a rejected reservation. Close the estimate
        // so billing reports do not treat this attempt as awaiting settlement.
        await this.billingService.markFailed(context.taskId, 'INSUFFICIENT_BALANCE');
        this.logger.warn(
          `预扣费失败（余额不足）：taskId=${context.taskId}, ` +
          `apiKey=${context.apiKey}, estimatedCost=${estimate.estimatedCost}`,
        );
        throw new InsufficientBalanceException(
          context.apiKey,
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
    return this.billingService.transaction(() => this.settleInTransaction(context));
  }

  private async settleInTransaction(context: BillingSettleContext): Promise<void> {
    const record = await this.billingService.getRecord(context.taskId);

    // exempt 任务无记录，直接返回
    if (!record) {
      this.logger.log(`结算跳过（无记录）：taskId=${context.taskId}`);
      return;
    }

    if (['settled', 'refunded', 'failed'].includes(record.status)) return;

    // Settle against the original billing record, never a fresh same-name model lookup.
    if (context.requestInput) {
      const canonicalParam = record.usageType === UsageType.DURATION ? 'duration' : record.usageType === UsageType.COUNT ? 'batch_quantity' : 'max_tokens';
      const input = { ...context.requestInput, ...(context.usageParam ? { [canonicalParam]: context.requestInput[context.usageParam] } : {}) };
      const raw = context.rawUsageResult as any;
      const source = raw?.data || raw;
      const result = source && typeof source === 'object' && !Array.isArray(source) ? { ...source, ...(context.resultPayload && typeof context.resultPayload === 'object' && !Array.isArray(context.resultPayload) ? context.resultPayload : {}) } : context.resultPayload;
      context.actualUsage = { usageType: record.usageType as UsageType, usageValue: computeActualUsageValue(record.usageType as UsageType, result, { durationStep: record.estimatedUsage, requestInput: input }) };
    }
    // Character units were derived from validated text at reservation time. Never trust
    // supplier duration/token fields or mutable model pricing for this measurement.
    if (record.usageMeasure === 'characters') context.actualUsage = { usageType: UsageType.COUNT, usageValue: record.estimatedUsage };
    if (!Number.isFinite(context.actualUsage.usageValue) || context.actualUsage.usageValue <= 0) throw new Error('Invalid settlement usage');
    const rawCost = record.unitPrice * context.actualUsage.usageValue;
    const actualCost = record.maxCharge === undefined ? rawCost : Math.min(rawCost, record.maxCharge);
    if (actualCost < rawCost) this.logger.warn(`Authorized charge capped: taskId=${context.taskId}, providerCost=${rawCost}, authorized=${actualCost}`);

    this.logger.log(
      `计费结算开始：taskId=${context.taskId}, billingPolicy=${record.billingPolicy}, ` +
      `status=${record.status}, actualUsage=${context.actualUsage.usageValue}, ` +
      `actualCost=${actualCost}`,
    );

    if (record.billingPolicy === BillingPolicy.INTERNAL) {
      if (record.status === BillingStatus.PRE_DEDUCTED) {
        // 预扣费任务：先解冻预扣金额，再扣实际费用
        await this.walletService.unfreeze(
          record.apiKey,
          record.estimatedCost,
          context.taskId,
          record.reservationTracked,
        );

        const debitOk = await this.walletService.debit(
          record.apiKey,
          actualCost,
          context.taskId,
        );

        if (!debitOk) {
          this.logger.warn(
            `结算扣费失败：taskId=${context.taskId}, apiKey=${record.apiKey}, ` +
            `actualCost=${actualCost}`,
          );
          throw new Error(`Debit failed for taskId=${context.taskId}`);
        }
      } else {
        // 后扣费任务（token 类型，状态为 estimated）：直接扣费
        const debitOk = await this.walletService.debit(
          record.apiKey,
          actualCost,
          context.taskId,
        );

        if (!debitOk) {
          this.logger.warn(
            `后扣费失败：taskId=${context.taskId}, apiKey=${record.apiKey}, ` +
            `actualCost=${actualCost}`,
          );
          throw new Error(`Debit failed for taskId=${context.taskId}`);
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
   * 2. billingPolicy=internal + pre_deducted → walletService.unfreeze()（与流水、账单同事务；写冲突由驱动重试整个事务）
   * 3. 调用 billingService.markRefunded()
   * 4. billingPolicy=external → 仅更新记录状态
   * 5. 非 pre_deducted 状态（如 token 类型）→ 仅更新记录状态，不涉及钱包
   */
  async refund(context: BillingRefundContext): Promise<void> {
    return this.billingService.transaction(() => this.refundInTransaction(context));
  }

  private async refundInTransaction(context: BillingRefundContext): Promise<void> {
    const record = await this.billingService.getRecord(context.taskId);

    // exempt 任务无记录，直接返回
    if (!record) {
      this.logger.log(`退款跳过（无记录）：taskId=${context.taskId}`);
      return;
    }

    if (['refunded', 'settled', 'failed'].includes(record.status)) return;

    this.logger.log(
      `计费退款开始：taskId=${context.taskId}, billingPolicy=${record.billingPolicy}, ` +
      `status=${record.status}, reason=${context.reason}`,
    );

    // internal + pre_deducted：需要解冻预扣金额
    if (
      record.billingPolicy === BillingPolicy.INTERNAL &&
      record.status === BillingStatus.PRE_DEDUCTED
    ) {
      await this.walletService.unfreeze(record.apiKey, record.estimatedCost, context.taskId, record.reservationTracked);
    }

    // 更新记录状态为 refunded（internal 和 external 都更新）
    await this.billingService.markRefunded(context.taskId);

    this.logger.log(`计费退款完成：taskId=${context.taskId}`);
  }

}
