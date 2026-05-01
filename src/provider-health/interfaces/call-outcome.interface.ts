/**
 * 单次 Provider API 调用的结果记录
 * 用于健康指标采集器记录每次调用的成功/失败、延迟和错误信息
 */
export interface CallOutcome {
  /** Provider 名称 */
  provider: string;

  /** 调用是否成功 */
  success: boolean;

  /** 响应延迟（毫秒） */
  latencyMs: number;

  /** 错误码（调用失败时提供） */
  errorCode?: string;

  /** 调用路径：submit（任务提交）或 query（轮询查询） */
  path: 'submit' | 'query';

  /** 调用时间戳（默认为当前时间） */
  timestamp?: Date;
}
