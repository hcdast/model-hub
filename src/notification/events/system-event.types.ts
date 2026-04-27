export enum SystemEventType {
  // Task lifecycle
  TASK_SUCCESS = 'task_success',
  TASK_FAILED = 'task_failed',
  TASK_TIMEOUT = 'task_timeout',
  // Provider
  PROVIDER_ERROR = 'provider_error',
  PROVIDER_RATE_LIMITED = 'provider_rate_limited',
  PROVIDER_UNAVAILABLE = 'provider_unavailable',
  // Queue
  QUEUE_BACKLOG_HIGH = 'queue_backlog_high',
  QUEUE_STALLED = 'queue_stalled',
  // Account
  ACCOUNT_BALANCE_LOW = 'account_balance_low',
  ACCOUNT_DISABLED = 'account_disabled',
}

export enum EventSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export interface SystemEvent {
  type: SystemEventType;
  severity: EventSeverity;
  timestamp: Date;
  source: string;
  payload: Record<string, any>;
}
