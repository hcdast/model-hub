/**
 * 钱包相关枚举和接口定义
 *
 * 包含交易类型枚举和钱包余额接口。
 */

/** 交易类型枚举 —— 钱包交易流水的操作类型 */
export enum TransactionType {
  /** 充值：增加余额 */
  CREDIT = 'credit',
  /** 扣费：减少余额 */
  DEBIT = 'debit',
  /** 冻结：预扣费时冻结余额 */
  FREEZE = 'freeze',
  /** 解冻：退款或结算时释放冻结余额 */
  UNFREEZE = 'unfreeze',
}

/** 钱包余额接口 —— WalletService.getBalance() 的返回值 */
export interface WalletBalance {
  /** 账户总余额 */
  balance: number;
  /** 冻结金额（预扣费占用） */
  frozenAmount: number;
  /** 可用余额 = balance - frozenAmount */
  available: number;
}
