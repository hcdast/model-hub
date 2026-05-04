import api from './api';

// ---- 计费记录相关类型 ----

/** 计费记录查询参数 */
export interface BillingRecordQuery {
  clientId?: string;
  model?: string;
  billingPolicy?: 'internal' | 'external';
  status?: 'estimated' | 'pre_deducted' | 'settled' | 'refunded' | 'failed';
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

/** 计费记录条目 */
export interface BillingRecordItem {
  _id: string;
  taskId: string;
  clientId: string;
  model: string;
  provider: string;
  usageType: 'token' | 'count' | 'duration';
  estimatedUsage: number;
  actualUsage: number;
  unitPrice: number;
  estimatedCost: number;
  actualCost: number;
  currency: string;
  billingPolicy: 'internal' | 'external';
  status: 'estimated' | 'pre_deducted' | 'settled' | 'refunded' | 'failed';
  settledAt?: string;
  refundedAt?: string;
  failReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- 计费汇总相关类型 ----

/** 计费汇总查询参数 */
export interface BillingSummaryQuery {
  groupBy?: 'model' | 'clientId' | 'date';
  billingPolicy?: 'internal' | 'external';
  startDate?: string;
  endDate?: string;
}

/** 计费汇总条目 */
export interface BillingSummaryItem {
  _id: string;
  totalEstimatedCost: number;
  totalActualCost: number;
  count: number;
}

// ---- 钱包相关类型 ----

/** 钱包余额信息 */
export interface WalletBalance {
  clientId: string;
  balance: number;
  frozenAmount: number;
  available: number;
  lowBalanceThreshold: number;
}

/** 交易记录查询参数 */
export interface TransactionQuery {
  page?: number;
  pageSize?: number;
  type?: 'credit' | 'debit' | 'freeze' | 'unfreeze';
}

/** 交易记录条目 */
export interface TransactionItem {
  _id: string;
  clientId: string;
  type: 'credit' | 'debit' | 'freeze' | 'unfreeze';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  relatedTaskId?: string;
  reason?: string;
  createdAt: string;
}

/** 钱包充值参数 */
export interface CreditWalletData {
  amount: number;
  reason: string;
}

/** 钱包列表查询参数 */
export interface WalletListQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/** 钱包列表条目 */
export interface WalletListItem {
  clientId: string;
  balance: number;
  frozenAmount: number;
  available: number;
  clientName?: string;
  billingPolicy?: string;
  enabled?: boolean;
  updatedAt: string;
}

// ---- 计费管理 API ----

export const billingApi = {
  /** 查询钱包列表 */
  listWallets: (params: WalletListQuery) =>
    api.get('/billing/wallets', { params }),

  /** 查询计费记录列表 */
  getRecords: (params: BillingRecordQuery) =>
    api.get('/billing/records', { params }),

  /** 查询计费汇总 */
  getSummary: (params: BillingSummaryQuery) =>
    api.get('/billing/summary', { params }),

  /** 查询指定 API Client 的钱包余额 */
  getWallet: (clientId: string) =>
    api.get(`/billing/wallets/${encodeURIComponent(clientId)}`),

  /** 查询指定 API Client 的交易记录 */
  getWalletTransactions: (clientId: string, params: TransactionQuery) =>
    api.get(`/billing/wallets/${encodeURIComponent(clientId)}/transactions`, { params }),

  /** 手动为指定 API Client 充值 */
  creditWallet: (clientId: string, data: CreditWalletData) =>
    api.post(`/billing/wallets/${encodeURIComponent(clientId)}/credit`, data),
};
