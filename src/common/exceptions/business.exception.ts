import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ERROR_MESSAGES } from '../constants/error-codes';

export class BusinessException extends HttpException {
  public readonly errorCode: ErrorCode;

  constructor(errorCode: ErrorCode, message?: string, status?: HttpStatus) {
    const msg = message || ERROR_MESSAGES[errorCode] || 'Unknown error';
    const httpStatus = status || BusinessException.inferStatus(errorCode);
    super({ code: errorCode, message: msg }, httpStatus);
    this.errorCode = errorCode;
  }

  private static inferStatus(code: ErrorCode): HttpStatus {
    if (code >= 1001 && code <= 1099) return HttpStatus.BAD_REQUEST;
    if (code === ErrorCode.UNAUTHORIZED) return HttpStatus.UNAUTHORIZED;
    if (code === ErrorCode.FORBIDDEN || code === ErrorCode.PERMISSION_DENIED || code === ErrorCode.INSUFFICIENT_PERMISSIONS) return HttpStatus.FORBIDDEN;
    if (code === ErrorCode.TASK_NOT_FOUND || code === ErrorCode.RESOURCE_NOT_FOUND || code === ErrorCode.USER_NOT_FOUND || code === ErrorCode.ROLE_NOT_FOUND) return HttpStatus.NOT_FOUND;
    if (code === ErrorCode.TASK_STATUS_CONFLICT || code === ErrorCode.ROLE_IN_USE) return HttpStatus.CONFLICT;
    if (code === ErrorCode.DUPLICATE_SUBMISSION) return HttpStatus.CONFLICT;
    if (code === ErrorCode.INVALID_PASSWORD) return HttpStatus.UNPROCESSABLE_ENTITY;
    if (code >= 4001 && code <= 4099) return HttpStatus.BAD_GATEWAY;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
