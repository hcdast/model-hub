export const NOTIFICATION_EVENTS = [
  'task_success', 'task_failed', 'task_timeout', 'provider_error', 'provider_rate_limited', 'provider_unavailable',
  'provider_circuit_open', 'provider_circuit_closed', 'provider_circuit_half_open',
  'queue_backlog_high', 'queue_stalled', 'account_balance_low', 'account_disabled',
];

export const EVENT_LABELS: Record<string, string> = {
  task_success: '任务成功', task_failed: '任务失败', task_timeout: '任务超时', provider_error: '供应商错误', provider_rate_limited: '供应商限流', provider_unavailable: '供应商不可用',
  provider_circuit_open: '熔断开启', provider_circuit_closed: '熔断恢复', provider_circuit_half_open: '熔断探测', queue_backlog_high: '队列积压', queue_stalled: '队列停滞', account_balance_low: '账号余额不足', account_disabled: '账号停用',
};
export const SEVERITY_LABELS: Record<string, string> = { info: '提示', warning: '警告', critical: '严重' };
