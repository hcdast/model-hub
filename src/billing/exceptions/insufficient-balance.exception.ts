/**
 * 余额不足异常
 *
 * 当 internal 策略的 API Client 余额不足以支付预扣费时抛出。
 * HTTP 状态码 402 (Payment Required)，错误码 INSUFFICIENT_BALANCE。
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export class InsufficientBalanceException extends HttpException {
  /** 错误码常量 */
  public static readonly ERROR_CODE = 'INSUFFICIENT_BALANCE';

  constructor(clientId: string, requiredAmount: number) {
    super(
      {
        success: false,
        code: InsufficientBalanceException.ERROR_CODE,
        message: `Insufficient balance for client ${clientId}, required: ${requiredAmount}`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
