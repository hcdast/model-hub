import { message } from 'antd';

/**
 * 验证错误接口
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

/**
 * 冲突信息接口
 */
export interface ConflictInfo {
  field: string;
  value: any;
  existingModelName: string;
}

/**
 * API 错误响应接口
 */
export interface ApiErrorResponse {
  code: number;
  message: string;
  errors?: ValidationError[];
  conflicts?: ConflictInfo[];
  timestamp?: number;
}

/**
 * 错误处理工具类
 * 提供统一的错误处理和友好提示
 */
export class ErrorHandler {
  /**
   * 处理 API 错误
   * @param error 错误对象
   * @param defaultMessage 默认错误消息
   */
  static handleApiError(error: any, defaultMessage: string = '操作失败'): void {
    // 如果是取消的请求，不显示错误
    if (error.code === 'ERR_CANCELED') {
      return;
    }

    // 获取错误响应数据
    const errorData: ApiErrorResponse | undefined = error.response?.data;

    if (!errorData) {
      // 网络错误或其他未知错误
      if (error.message === 'Network Error') {
        message.error('网络连接失败，请检查网络后重试');
      } else if (error.code === 'ECONNABORTED') {
        message.error('请求超时，请稍后重试');
      } else {
        message.error(defaultMessage);
      }
      return;
    }

    // 根据错误类型显示不同的提示
    switch (errorData.code) {
      case 1001:
        // 数据验证失败
        this.handleValidationError(errorData);
        break;

      case 1002:
        // 唯一性冲突
        this.handleConflictError(errorData);
        break;

      case 3001:
        // 资源不存在
        message.error(errorData.message || '资源不存在');
        break;

      case 403:
        // 权限错误
        message.error('您没有权限执行此操作');
        break;

      case 401:
        // 未授权（由 axios 拦截器处理）
        break;

      case 500:
        // 服务器错误
        message.error(errorData.message || '服务器错误，请稍后重试');
        break;

      default:
        // 其他错误
        message.error(errorData.message || defaultMessage);
    }
  }

  /**
   * 处理验证错误
   * @param errorData 错误响应数据
   */
  private static handleValidationError(errorData: ApiErrorResponse): void {
    if (errorData.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
      // 显示所有验证错误
      const errorMessages = errorData.errors
        .map((e) => `${e.field}: ${e.message}`)
        .join('\n');

      message.error({
        content: (
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: 8 }}>数据验证失败：</div>
            <div style={{ whiteSpace: 'pre-line' }}>{errorMessages}</div>
          </div>
        ),
        duration: 5,
      });
    } else {
      message.error(errorData.message || '数据验证失败');
    }
  }

  /**
   * 处理唯一性冲突错误
   * @param errorData 错误响应数据
   */
  private static handleConflictError(errorData: ApiErrorResponse): void {
    if (errorData.conflicts && Array.isArray(errorData.conflicts) && errorData.conflicts.length > 0) {
      // 显示所有冲突信息
      const conflictMessages = errorData.conflicts
        .map((c) => {
          if (c.field === 'model_id+model_type') {
            return `模型标识 (${c.value}) 已被 "${c.existingModelName}" 使用`;
          } else if (c.field === 'provider_model_name') {
            return `厂商模型名 "${c.value}" 已被 "${c.existingModelName}" 使用`;
          } else {
            return `${c.field} 已存在`;
          }
        })
        .join('\n');

      message.error({
        content: (
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: 8 }}>配置冲突：</div>
            <div style={{ whiteSpace: 'pre-line' }}>{conflictMessages}</div>
          </div>
        ),
        duration: 5,
      });
    } else {
      message.error(errorData.message || '配置已存在');
    }
  }

  /**
   * 显示成功提示
   * @param content 提示内容
   * @param duration 显示时长（秒）
   */
  static showSuccess(content: string, duration: number = 3): void {
    message.success(content, duration);
  }

  /**
   * 显示警告提示
   * @param content 提示内容
   * @param duration 显示时长（秒）
   */
  static showWarning(content: string, duration: number = 3): void {
    message.warning(content, duration);
  }

  /**
   * 显示信息提示
   * @param content 提示内容
   * @param duration 显示时长（秒）
   */
  static showInfo(content: string, duration: number = 3): void {
    message.info(content, duration);
  }

  /**
   * 显示加载提示
   * @param content 提示内容
   * @returns 关闭函数
   */
  static showLoading(content: string = '加载中...'): () => void {
    return message.loading(content, 0);
  }
}
