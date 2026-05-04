import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCode } from '../constants/error-codes';
import { ErrorLogger } from '../utils/error-logger.util';
import { BusinessException } from '../exceptions/business.exception';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: number = ErrorCode.INTERNAL_ERROR;
    let message = 'Internal server error';

    // 提取上下文信息
    const context = {
      requestId: (request as any).id,
      path: request.path,
      method: request.method,
      clientId: (request as any).clientId,
      ip: request.ip,
    };

    if (exception instanceof BusinessException) {
      // BusinessException (including RBAC exceptions) — preserve the specific error code
      status = exception.getStatus();
      code = exception.errorCode;
      const exResponse = exception.getResponse();
      message =
        typeof exResponse === 'string'
          ? exResponse
          : (exResponse as any).message || exception.message;

      if (status >= 500) {
        ErrorLogger.logError(this.logger, exception, context, `HTTP ${status} exception caught`);
      } else if (status >= 400) {
        ErrorLogger.logWarning(this.logger, `HTTP ${status}: ${message}`, context);
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      code = this.mapHttpStatusToCode(status);
      message =
        typeof exResponse === 'string'
          ? exResponse
          : (exResponse as any).message || exception.message;
      if (Array.isArray(message)) {
        message = message.join('; ');
      }

      // 保留 errors 字段（如参数校验错误详情）
      if (typeof exResponse === 'object' && exResponse !== null && 'errors' in exResponse) {
        (context as any).errors = (exResponse as any).errors;
      }

      // 记录 HTTP 异常（4xx 用 warn，5xx 用 error）
      if (status >= 500) {
        ErrorLogger.logError(
          this.logger,
          exception,
          context,
          `HTTP ${status} exception caught`,
        );
      } else if (status >= 400) {
        ErrorLogger.logWarning(
          this.logger,
          `HTTP ${status}: ${message}`,
          context,
        );
      }
    } else if (exception instanceof Error) {
      // 记录未捕获的错误（带堆栈）
      ErrorLogger.logError(
        this.logger,
        exception,
        context,
        'Unhandled exception caught',
      );
      message = 'Internal server error';
    } else {
      // 记录未知类型的异常
      this.logger.error(
        `Unknown exception type: ${typeof exception} | ${String(exception)}`,
      );
    }

    const body: Record<string, any> = {
      statusCode: status,
      code,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
    if ((context as any).errors) {
      body.errors = (context as any).errors;
    }
    response.status(status).json(body);
  }

  private mapHttpStatusToCode(status: number): ErrorCode {
    switch (status) {
      case 400:
        return ErrorCode.INVALID_PARAMS;
      case 401:
        return ErrorCode.UNAUTHORIZED;
      case 403:
        return ErrorCode.FORBIDDEN;
      case 404:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case 409:
        return ErrorCode.TASK_STATUS_CONFLICT;
      case 422:
        return ErrorCode.INVALID_PARAMS;
      case 429:
        return ErrorCode.PROVIDER_RATE_LIMITED;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
