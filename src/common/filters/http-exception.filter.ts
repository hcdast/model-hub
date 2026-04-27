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
 * HTTP 异常过滤器
 * 统一处理 HTTP 异常，返回友好的错误信息
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // 记录错误日志
    this.logger.error(
      `HTTP ${status} Error: ${request.method} ${request.url}`,
      exception.stack,
    );

    // 构建错误响应
    const errorResponse: any = {
      code: this.mapStatusToCode(status),
      message: this.getErrorMessage(exceptionResponse),
      timestamp: Date.now(),
      path: request.url,
    };

    // 如果是验证错误，添加详细信息
    if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
      const response = exceptionResponse as any;
      
      // 处理验证错误
      if (Array.isArray(response.message)) {
        errorResponse.errors = response.message.map((msg: string) => {
          // 解析验证错误消息（格式：field: message）
          const parts = msg.split(':');
          if (parts.length >= 2) {
            return {
              field: parts[0].trim(),
              message: parts.slice(1).join(':').trim(),
            };
          }
          return {
            field: 'unknown',
            message: msg,
          };
        });
      }
    }

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
   */
  private getErrorMessage(exceptionResponse: string | object): string {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
      const response = exceptionResponse as any;
      
      // 如果是数组，返回第一个错误消息
      if (Array.isArray(response.message)) {
        return response.message[0] || '请求参数错误';
      }
      
      return response.message || '请求失败';
    }

    return '请求失败';
  }
}
