/**
 * 计费上下文接口定义
 *
 * BillingAdapter 的三个核心方法（initBilling / settle / refund）所需的上下文参数。
 */

import { UsageType } from './billing.interface';

/** 计费初始化上下文 —— 任务创建时传入 BillingAdapter.initBilling() */
export interface BillingInitContext {
  /** 任务 ID */
  taskId: string;
  /** API 客户端主键，用于查询计费策略 */
  apiKey: string;
  /** 模型名称，用于查询定价 */
  model: string;
  /** 供应商标识 */
  provider: string;
  /** 功能类型（如 faceswap、tts 等） */
  featureType: string;
  /** 任务输入参数，用于预估用量 */
  input: Record<string, any>;
  /** 任务可选参数 */
  options?: Record<string, any>;
}

/** 计费结算上下文 —— 任务成功完成时传入 BillingAdapter.settle() */
export interface BillingSettleContext {
  /** 任务 ID */
  taskId: string;
  /** 实际用量信息 */
  actualUsage: {
    /** 用量类型 */
    usageType: UsageType;
    /** 实际用量值（token 数 / 次数 / 秒数） */
    usageValue: number;
  };
  /** 供应商返回的结果负载（可选） */
  resultPayload?: Record<string, any>;
}

/** 计费退款上下文 —— 任务失败或超时时传入 BillingAdapter.refund() */
export interface BillingRefundContext {
  /** 任务 ID */
  taskId: string;
  /** 退款原因（如 provider_failed、poll_timeout 等） */
  reason: string;
}
