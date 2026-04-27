export enum TaskStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  TIMEOUT = 'TIMEOUT',
  CANCELLED = 'CANCELLED',
}

export enum CallbackStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.SUCCESS,
  TaskStatus.FAILED,
  TaskStatus.TIMEOUT,
  TaskStatus.CANCELLED,
]);

export const POLLABLE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.SUBMITTED,
  TaskStatus.PROCESSING,
]);

export const CANCELLABLE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.PENDING,
  TaskStatus.SUBMITTED,
]);
