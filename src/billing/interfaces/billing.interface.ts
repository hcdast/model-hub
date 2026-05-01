/**
 * 计费相关枚举和接口定义
 *
 * 包含用量类型、计费状态、计费策略枚举，以及价格预估接口。
 */

/** 用量类型枚举 —— 对应不同的计费模式 */
export enum UsageType {
  /** LLM 按 token 计费 */
  TOKEN = 'token',
  /** 图像按次计费 */
  COUNT = 'count',
  /** 视频按时长计费 */
  DURATION = 'duration',
}

/** 计费状态枚举 —— BillingRecord 的生命周期状态 */
export enum BillingStatus {
  /** 预估：任务创建时基于预估用量计算费用 */
  ESTIMATED = 'estimated',
  /** 已预扣：预扣费成功，余额已冻结（仅 internal + count/duration） */
  PRE_DEDUCTED = 'pre_deducted',
  /** 已结算：任务完成，按实际用量结算 */
  SETTLED = 'settled',
  /** 已退款：任务失败，预扣费用已退还 */
  REFUNDED = 'refunded',
  /** 计费失败：结算或退款过程中出错 */
  FAILED = 'failed',
}

/** 计费策略枚举 —— 绑定在 API Client 上，决定计费行为 */
export enum BillingPolicy {
  /** 内部计费：走完整的 Pricing → Billing → Wallet 扣费链路 */
  INTERNAL = 'internal',
  /** 外部计费：仅记录用量，不执行 Wallet 扣费（如 AGI-content） */
  EXTERNAL = 'external',
  /** 免计费：跳过所有计费逻辑，不记录不扣费 */
  EXEMPT = 'exempt',
}

/** 价格预估接口 —— PricingService.estimate() 的返回值 */
export interface PriceEstimate {
  /** 模型名称 */
  model: string;
  /** 用量类型 */
  usageType: UsageType;
  /** 单价 */
  unitPrice: number;
  /** 预估用量 */
  estimatedUsage: number;
  /** 预估费用 = unitPrice × estimatedUsage */
  estimatedCost: number;
  /** 货币单位，默认 'credit' */
  currency: string;
}
