import {
  SystemEvent,
  SystemEventType,
  EventSeverity,
} from './system-event.types';

export function buildTaskEvent(
  taskId: string,
  model: string,
  provider: string,
  status: 'success' | 'failed' | 'timeout',
  durationMs: number,
): SystemEvent {
  const typeMap: Record<string, SystemEventType> = {
    success: SystemEventType.TASK_SUCCESS,
    failed: SystemEventType.TASK_FAILED,
    timeout: SystemEventType.TASK_TIMEOUT,
  };
  const severityMap: Record<string, EventSeverity> = {
    success: EventSeverity.INFO,
    failed: EventSeverity.WARNING,
    timeout: EventSeverity.CRITICAL,
  };

  return {
    type: typeMap[status],
    severity: severityMap[status],
    timestamp: new Date(),
    source: 'TaskService',
    payload: { taskId, model, provider, status, durationMs },
  };
}

export function buildProviderEvent(
  providerName: string,
  errorCode: string,
  errorMessage: string,
): SystemEvent {
  return {
    type: SystemEventType.PROVIDER_ERROR,
    severity: EventSeverity.CRITICAL,
    timestamp: new Date(),
    source: 'ProviderAdapter',
    payload: { providerName, errorCode, errorMessage },
  };
}

export function buildQueueEvent(
  queueName: string,
  currentDepth: number,
  threshold: number,
): SystemEvent {
  return {
    type: SystemEventType.QUEUE_BACKLOG_HIGH,
    severity: EventSeverity.WARNING,
    timestamp: new Date(),
    source: 'QueueStatsCollector',
    payload: { queueName, currentDepth, threshold },
  };
}

export function buildAccountEvent(
  accountId: string,
  eventType: SystemEventType.ACCOUNT_BALANCE_LOW | SystemEventType.ACCOUNT_DISABLED,
  details: Record<string, any>,
): SystemEvent {
  return {
    type: eventType,
    severity:
      eventType === SystemEventType.ACCOUNT_DISABLED
        ? EventSeverity.CRITICAL
        : EventSeverity.WARNING,
    timestamp: new Date(),
    source: 'AccountPool',
    payload: { accountId, ...details },
  };
}

/**
 * 构建熔断器 CLOSED→OPEN 状态转换事件
 * severity=CRITICAL，payload 含 provider, errorRate, consecutiveFailures, timestamp
 */
export function buildCircuitOpenEvent(
  provider: string,
  errorRate: number,
  consecutiveFailures: number,
  timestamp: string,
): SystemEvent {
  return {
    type: SystemEventType.PROVIDER_CIRCUIT_OPEN,
    severity: EventSeverity.CRITICAL,
    timestamp: new Date(),
    source: 'CircuitBreakerService',
    payload: { provider, errorRate, consecutiveFailures, timestamp },
  };
}

/**
 * 构建熔断器 *→CLOSED 状态转换事件
 * severity=INFO，payload 含 provider, recoveryTimestamp
 */
export function buildCircuitClosedEvent(
  provider: string,
  recoveryTimestamp: string,
): SystemEvent {
  return {
    type: SystemEventType.PROVIDER_CIRCUIT_CLOSED,
    severity: EventSeverity.INFO,
    timestamp: new Date(),
    source: 'CircuitBreakerService',
    payload: { provider, recoveryTimestamp },
  };
}

/**
 * 构建熔断器 OPEN→HALF_OPEN 状态转换事件
 * severity=WARNING，payload 含 provider
 */
export function buildCircuitHalfOpenEvent(
  provider: string,
): SystemEvent {
  return {
    type: SystemEventType.PROVIDER_CIRCUIT_HALF_OPEN,
    severity: EventSeverity.WARNING,
    timestamp: new Date(),
    source: 'CircuitBreakerService',
    payload: { provider },
  };
}
