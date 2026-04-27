import { TaskStatus } from '../../common/constants/task-status';

export interface NormalizedTaskRequest {
  taskId: string;
  model: string;
  input: Record<string, any>;
  options?: Record<string, any>;
}

export interface SubmitResult {
  providerTaskId: string;
  isSync: boolean;
  result?: any;
  rawResponse?: any;
}

export interface QueryResult {
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  progress?: number;
  result?: any;
  error?: { code: string; message: string };
  rawResponse?: any;
}

export interface CancelResult {
  accepted: boolean;
  message?: string;
}

export interface RateLimitConfig {
  maxConcurrent: number;
  maxPerSecond: number;
  maxPerMinute?: number;
}

export interface IProviderAdapter {
  readonly providerName: string;

  submitTask(request: NormalizedTaskRequest): Promise<SubmitResult>;
  queryTask(providerTaskId: string, meta?: Record<string, any>): Promise<QueryResult>;
  cancelTask?(providerTaskId: string): Promise<CancelResult>;
  mapStatus(providerStatus: string): TaskStatus;
  mapError(providerError: any): { code: string; message: string; retryable: boolean };
  getRateLimitConfig(): RateLimitConfig;
}
