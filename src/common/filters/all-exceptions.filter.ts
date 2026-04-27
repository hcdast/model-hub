import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * 全局异常过滤器
 * 捕获所有未处理的异常，返回友好的错误信息
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let code = 500;

    // 如果是 HTTP 异常
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
        message = (exceptionResponse as any).message;
      }
      
      code = this.mapStatusToCode(status);
    } else if (exception instanceof Error) {
      // 普通错误
      message = exception.message || '服务器内部错误';
      
      // 记录详细的错误堆栈
      this.logger.error(
        `Unhandled Exception: ${request.method} ${request.url}`,
        exception.stack,
      );
    } else {
      // 未知错误
      this.logger.error(
        `Unknown Exception: ${request.method} ${request.url}`,
        exception,
      );
    }

    // 构建错误响应
    const errorResponse = {
      code,
      message: this.getFriendlyMessage(message),
      timestamp: Date.now(),
      path: request.url,
    };

    response.status(status).json(errorResponse);
  }

  /**
   * 将 HTTP 状态码映射到业务错误码
   */
  private mapStatusToCode(status: number): number {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 1001; // 数据验证失败
      case HttpStatus.UNAUTHORIZED:
        return 401; // 未授权
      case HttpStatus.FORBIDDEN:
        return 403; // 权限不足
      case HttpStatus.NOT_FOUND:
        return 3001; // 资源不存在
      case HttpStatus.CONFLICT:
        return 1002; // 唯一性冲突
      case HttpStatus.INTERNAL_SERVER_ERROR:
        return 500; // 服务器错误
      default:
        return status;
    }
  }

  /**
   * 获取友好的错误消息
   * 避免将技术性错误直接暴露给用户
   */
  private getFriendlyMessage(message: string): string {
    // 数据库错误
    if (message.includes('duplicate key') || message.includes('E11000')) {
      return '数据已存在，请检查后重试';
    }

    // 连接错误
    if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT')) {
      return '服务暂时不可用，请稍后重试';
    }

    // 验证错误
    if (message.includes('validation') || message.includes('invalid')) {
      return '数据验证失败，请检查输入';
    }

    // 权限错误
    if (message.includes('permission') || message.includes('forbidden')) {
      return '您没有权限执行此操作';
    }

    // 其他错误保持原样（如果是业务错误消息）
    return message;
  }
}
