import { Logger } from '@nestjs/common';

/**
 * 错误日志上下文信息
 */
export interface ErrorContext {
  /** 任务 ID */
  taskId?: string;
  /** 客户端 ID */
  apiKey?: string;
  /** 厂商名称 */
  provider?: string;
  /** 模型名称 */
  model?: string;
  /** 功能类型 */
  featureType?: string;
  /** 队列名称 */
  queueName?: string;
  /** 作业 ID */
  jobId?: string;
  /** 请求 ID */
  requestId?: string;
  /** 用户 ID */
  userId?: string;
  /** 其他上下文 */
  [key: string]: any;
}

/**
 * 结构化错误信息
 */
export interface StructuredError {
  /** 错误码 */
  code: string | number;
  /** 错误消息 */
  message: string;
  /** 错误堆栈 */
  stack?: string;
  /** 上下文信息 */
  context?: ErrorContext;
  /** 原始错误 */
  originalError?: any;
  /** 时间戳 */
  timestamp: string;
  /** 是否可重试 */
  retryable?: boolean;
}

/**
 * 统一的错误日志工具类
 */
export class ErrorLogger {
  /**
   * 记录错误日志（带堆栈跟踪）
   */
  static logError(
    logger: Logger,
    error: Error | any,
    context?: ErrorContext,
    additionalMessage?: string,
  ): void {
    const structured = this.structureError(error, context);
    
    const logMessage = this.formatErrorMessage(structured, additionalMessage);
    
    // 记录错误日志，包含堆栈
    if (error instanceof Error && error.stack) {
      logger.error(logMessage, error.stack);
    } else {
      logger.error(logMessage);
    }
  }

  /**
   * 记录警告日志
   */
  static logWarning(
    logger: Logger,
    message: string,
    context?: ErrorContext,
  ): void {
    const logMessage = this.formatWarningMessage(message, context);
    logger.warn(logMessage);
  }

  /**
   * 结构化错误信息
   */
  static structureError(
    error: Error | any,
    context?: ErrorContext,
  ): StructuredError {
    const structured: StructuredError = {
      code: error.code || error.errorCode || 'UNKNOWN_ERROR',
      message: error.message || String(error),
      timestamp: new Date().toISOString(),
      context,
    };

    // 提取堆栈信息
    if (error instanceof Error && error.stack) {
      structured.stack = error.stack;
    }

    // 提取可重试标志
    if (typeof error.retryable === 'boolean') {
      structured.retryable = error.retryable;
    }

    // 保存原始错误（用于调试）
    if (error.response || error.config) {
      structured.originalError = {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
        method: error.config?.method,
      };
    }

    return structured;
  }

  /**
   * 格式化错误消息
   */
  private static formatErrorMessage(
    structured: StructuredError,
    additionalMessage?: string,
  ): string {
    const parts: string[] = [];

    // 添加额外消息
    if (additionalMessage) {
      parts.push(additionalMessage);
    }

    // 添加错误码和消息
    parts.push(`[${structured.code}] ${structured.message}`);

    // 添加上下文信息
    if (structured.context) {
      const contextParts: string[] = [];
      
      if (structured.context.taskId) {
        contextParts.push(`taskId=${structured.context.taskId}`);
      }
      if (structured.context.apiKey) {
        contextParts.push(`apiKey=${structured.context.apiKey}`);
      }
      if (structured.context.provider) {
        contextParts.push(`provider=${structured.context.provider}`);
      }
      if (structured.context.model) {
        contextParts.push(`model=${structured.context.model}`);
      }
      if (structured.context.featureType) {
        contextParts.push(`featureType=${structured.context.featureType}`);
      }
      if (structured.context.queueName) {
        contextParts.push(`queue=${structured.context.queueName}`);
      }
      if (structured.context.jobId) {
        contextParts.push(`jobId=${structured.context.jobId}`);
      }

      if (contextParts.length > 0) {
        parts.push(`| ${contextParts.join(', ')}`);
      }
    }

    // 添加可重试标志
    if (structured.retryable !== undefined) {
      parts.push(`| retryable=${structured.retryable}`);
    }

    // 添加原始错误信息（如果是 HTTP 错误）
    if (structured.originalError) {
      const orig = structured.originalError;
      if (orig.status) {
        parts.push(`| HTTP ${orig.status} ${orig.statusText || ''}`);
      }
      if (orig.url) {
        parts.push(`| ${orig.method || 'GET'} ${orig.url}`);
      }
    }

    return parts.join(' ');
  }

  /**
   * 格式化警告消息
   */
  private static formatWarningMessage(
    message: string,
    context?: ErrorContext,
  ): string {
    const parts: string[] = [message];

    if (context) {
      const contextParts: string[] = [];
      
      Object.entries(context).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          contextParts.push(`${key}=${value}`);
        }
      });

      if (contextParts.length > 0) {
        parts.push(`| ${contextParts.join(', ')}`);
      }
    }

    return parts.join(' ');
  }

  /**
   * 提取错误的简短描述（用于指标标签）
   */
  static getErrorLabel(error: Error | any): string {
    if (error.code) return String(error.code);
    if (error.errorCode) return String(error.errorCode);
    if (error.response?.status) return `HTTP_${error.response.status}`;
    if (error.name) return error.name;
    return 'UNKNOWN_ERROR';
  }
}
