export enum ErrorCode {
  SUCCESS = 0,

  // 客户端错误 (1000-1999)
  INVALID_PARAMS = 1001,
  UNSUPPORTED_MODEL = 1002,
  DUPLICATE_SUBMISSION = 1003,
  MODEL_DISABLED = 1004,
  INVALID_MODEL_FORMAT = 1005,
  MISSING_REQUIRED_FIELD = 1006,
  INVALID_FIELD_TYPE = 1007,
  FIELD_OUT_OF_RANGE = 1008,

  // 认证授权错误 (2000-2999)
  UNAUTHORIZED = 2001,
  FORBIDDEN = 2002,
  INVALID_API_KEY = 2003,
  API_KEY_EXPIRED = 2004,
  INVALID_JWT_TOKEN = 2005,
  JWT_TOKEN_EXPIRED = 2006,
  INSUFFICIENT_PERMISSIONS = 2007,
  PERMISSION_DENIED = 2008,
  INVALID_PASSWORD = 2009,

  // 资源错误 (3000-3999)
  TASK_NOT_FOUND = 3001,
  TASK_STATUS_CONFLICT = 3002,
  TASK_CANCELLED = 3003,
  TASK_TIMEOUT = 3004,
  RESOURCE_NOT_FOUND = 3005,
  USER_NOT_FOUND = 3006,
  ROLE_NOT_FOUND = 3007,
  ROLE_IN_USE = 3008,

  // 厂商错误 (4000-4999)
  PROVIDER_ERROR = 4001,
  PROVIDER_RATE_LIMITED = 4002,
  PROVIDER_TIMEOUT = 4003,
  PROVIDER_NOT_FOUND = 4004,
  PROVIDER_UNAVAILABLE = 4005,
  PROVIDER_INVALID_RESPONSE = 4006,
  PROVIDER_AUTHENTICATION_FAILED = 4007,
  PROVIDER_INSUFFICIENT_BALANCE = 4008,

  // 服务器错误 (5000-5999)
  INTERNAL_ERROR = 5001,
  SERVICE_UNAVAILABLE = 5002,
  DATABASE_ERROR = 5003,
  REDIS_ERROR = 5004,
  QUEUE_ERROR = 5005,
  CONFIGURATION_ERROR = 5006,
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.SUCCESS]: 'Success',

  // 客户端错误
  [ErrorCode.INVALID_PARAMS]: 'Invalid parameters',
  [ErrorCode.UNSUPPORTED_MODEL]: 'Unsupported model',
  [ErrorCode.DUPLICATE_SUBMISSION]: 'Duplicate submission',
  [ErrorCode.MODEL_DISABLED]: 'Model is disabled',
  [ErrorCode.INVALID_MODEL_FORMAT]: 'Invalid model format',
  [ErrorCode.MISSING_REQUIRED_FIELD]: 'Missing required field',
  [ErrorCode.INVALID_FIELD_TYPE]: 'Invalid field type',
  [ErrorCode.FIELD_OUT_OF_RANGE]: 'Field value out of range',

  // 认证授权错误
  [ErrorCode.UNAUTHORIZED]: 'Unauthorized',
  [ErrorCode.FORBIDDEN]: 'Forbidden',
  [ErrorCode.INVALID_API_KEY]: 'Invalid API Key',
  [ErrorCode.API_KEY_EXPIRED]: 'API Key expired',
  [ErrorCode.INVALID_JWT_TOKEN]: 'Invalid JWT Token',
  [ErrorCode.JWT_TOKEN_EXPIRED]: 'JWT Token expired',
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 'Insufficient permissions',
  [ErrorCode.PERMISSION_DENIED]: 'Permission denied',
  [ErrorCode.INVALID_PASSWORD]: 'Invalid password',

  // 资源错误
  [ErrorCode.TASK_NOT_FOUND]: 'Task not found',
  [ErrorCode.TASK_STATUS_CONFLICT]: 'Task status does not allow this operation',
  [ErrorCode.TASK_CANCELLED]: 'Task was cancelled',
  [ErrorCode.TASK_TIMEOUT]: 'Task timeout',
  [ErrorCode.RESOURCE_NOT_FOUND]: 'Resource not found',
  [ErrorCode.USER_NOT_FOUND]: 'User not found',
  [ErrorCode.ROLE_NOT_FOUND]: 'Role not found',
  [ErrorCode.ROLE_IN_USE]: 'Role is in use and cannot be deleted',

  // 厂商错误
  [ErrorCode.PROVIDER_ERROR]: 'Provider call failed',
  [ErrorCode.PROVIDER_RATE_LIMITED]: 'Provider rate limited',
  [ErrorCode.PROVIDER_TIMEOUT]: 'Provider timeout',
  [ErrorCode.PROVIDER_NOT_FOUND]: 'Provider not found',
  [ErrorCode.PROVIDER_UNAVAILABLE]: 'Provider unavailable',
  [ErrorCode.PROVIDER_INVALID_RESPONSE]: 'Provider returned invalid response',
  [ErrorCode.PROVIDER_AUTHENTICATION_FAILED]: 'Provider authentication failed',
  [ErrorCode.PROVIDER_INSUFFICIENT_BALANCE]: 'Provider account insufficient balance',

  // 服务器错误
  [ErrorCode.INTERNAL_ERROR]: 'Internal server error',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service unavailable',
  [ErrorCode.DATABASE_ERROR]: 'Database error',
  [ErrorCode.REDIS_ERROR]: 'Redis error',
  [ErrorCode.QUEUE_ERROR]: 'Queue error',
  [ErrorCode.CONFIGURATION_ERROR]: 'Configuration error',
};

/**
 * 判断错误码是否表示可重试的错误
 */
export function isRetryableError(code: ErrorCode): boolean {
  const retryableCodes = new Set([
    ErrorCode.PROVIDER_RATE_LIMITED,
    ErrorCode.PROVIDER_TIMEOUT,
    ErrorCode.PROVIDER_UNAVAILABLE,
    ErrorCode.SERVICE_UNAVAILABLE,
    ErrorCode.DATABASE_ERROR,
    ErrorCode.REDIS_ERROR,
    ErrorCode.QUEUE_ERROR,
  ]);
  return retryableCodes.has(code);
}

/**
 * 根据错误码获取 HTTP 状态码
 */
export function getHttpStatusForErrorCode(code: ErrorCode): number {
  if (code >= 1001 && code <= 1099) return 400; // Bad Request
  if (code === ErrorCode.UNAUTHORIZED || code === ErrorCode.INVALID_API_KEY) return 401;
  if (code === ErrorCode.FORBIDDEN || code === ErrorCode.INSUFFICIENT_PERMISSIONS || code === ErrorCode.PERMISSION_DENIED) return 403;
  if (code === ErrorCode.INVALID_PASSWORD) return 422;
  if (code === ErrorCode.TASK_NOT_FOUND || code === ErrorCode.RESOURCE_NOT_FOUND || code === ErrorCode.USER_NOT_FOUND || code === ErrorCode.ROLE_NOT_FOUND) return 404;
  if (code === ErrorCode.TASK_STATUS_CONFLICT || code === ErrorCode.DUPLICATE_SUBMISSION || code === ErrorCode.ROLE_IN_USE) return 409;
  if (code === ErrorCode.PROVIDER_RATE_LIMITED) return 429;
  if (code >= 4001 && code <= 4099) return 502; // Bad Gateway
  if (code === ErrorCode.SERVICE_UNAVAILABLE) return 503;
  if (code === ErrorCode.PROVIDER_TIMEOUT) return 504;
  return 500; // Internal Server Error
}
