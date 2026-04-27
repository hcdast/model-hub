import { HttpStatus } from '@nestjs/common';
import { BusinessException } from './business.exception';
import { ErrorCode } from '../constants/error-codes';

/**
 * 用户未找到异常
 */
export class UserNotFoundException extends BusinessException {
  constructor(identifier: string) {
    super(
      ErrorCode.USER_NOT_FOUND,
      `User "${identifier}" not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 角色未找到异常
 */
export class RoleNotFoundException extends BusinessException {
  constructor(roleName: string) {
    super(
      ErrorCode.ROLE_NOT_FOUND,
      `Role "${roleName}" not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 权限拒绝异常
 */
export class PermissionDeniedException extends BusinessException {
  constructor(message?: string) {
    super(
      ErrorCode.PERMISSION_DENIED,
      message || 'Permission denied',
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * 角色正在使用中异常
 */
export class RoleInUseException extends BusinessException {
  constructor(roleName: string) {
    super(
      ErrorCode.ROLE_IN_USE,
      `Cannot delete role "${roleName}" because it is assigned to one or more users`,
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 无效密码异常
 */
export class InvalidPasswordException extends BusinessException {
  constructor(message?: string) {
    super(
      ErrorCode.INVALID_PASSWORD,
      message || 'Invalid password',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
