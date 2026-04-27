import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Optional,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditLogService } from '../audit-log.service';
import { Reflector } from '@nestjs/core';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { AuditAnchorPlugin } from '../plugins/audit-anchor.plugin';

/**
 * 审计拦截器
 * 自动拦截写操作（POST/PUT/PATCH/DELETE）并记录审计日志。
 * 通过 AuditAnchorPlugin 动态获取资源类型映射，替代硬编码方式。
 * 支持从描述符配置中读取需要额外审计的 GET 操作。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: AuditLogService,
    private readonly reflector: Reflector,
    /** 审计锚点插件（可选注入，插件未注册时降级为默认行为） */
    @Optional() private readonly auditAnchorPlugin?: AuditAnchorPlugin,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const method = request.method;

    // 判断是否为写操作
    const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const handlerName = context.getHandler().name;
    const controllerName = context.getClass().name.replace('Controller', '');

    // 检查当前 GET 请求是否需要审计（通过描述符中的 auditGetActions 配置）
    const isAuditedGetAction =
      method === 'GET' &&
      this.auditAnchorPlugin?.shouldAuditGetAction(controllerName, handlerName);

    // 写操作或被标记的 GET 操作需要审计
    const shouldAudit = isWriteOperation || isAuditedGetAction;

    const startTime = Date.now();
    const action = `${controllerName}.${handlerName}`;
    // 通过 AuditAnchorPlugin 动态解析资源类型
    const resource = this.resolveResourceType(controllerName);

    return next.handle().pipe(
      tap({
        next: (data) => {
          if (!shouldAudit) return;

          // 记录成功操作的审计日志
          this.auditService.log({
            action,
            operator: user?.username || 'anonymous',
            ip: request.ip,
            resource,
            resourceId: this.getResourceId(data),
            result: 'success',
            requestParams: this.sanitizeParams(request.body),
            userAgent: request.headers['user-agent'],
            detail: {
              duration: Date.now() - startTime,
              method,
              path: request.path,
            },
          });
        },
      }),
      catchError((error) => {
        // 权限拒绝错误始终记录审计日志，不受请求方法限制
        const isPermissionError =
          error instanceof BusinessException &&
          (error.errorCode === ErrorCode.PERMISSION_DENIED ||
           error.errorCode === ErrorCode.INSUFFICIENT_PERMISSIONS);

        if (shouldAudit || isPermissionError) {
          // 记录失败操作的审计日志
          this.auditService.log({
            action,
            operator: user?.username || 'anonymous',
            ip: request.ip,
            resource,
            result: 'failure',
            errorMessage: error.message,
            requestParams: this.sanitizeParams(request.body),
            userAgent: request.headers['user-agent'],
            detail: {
              duration: Date.now() - startTime,
              method,
              path: request.path,
              statusCode: error.status || 500,
              errorCode: error instanceof BusinessException ? error.errorCode : undefined,
            },
          });
        }

        return throwError(() => error);
      }),
    );
  }

  /**
   * 动态解析资源类型
   * 优先通过 AuditAnchorPlugin 从描述符配置中获取，
   * 插件不可用时降级为控制器名称小写。
   */
  private resolveResourceType(controllerName: string): string {
    if (this.auditAnchorPlugin) {
      return this.auditAnchorPlugin.getResourceType(controllerName);
    }
    // 降级策略：插件未注入时使用控制器名称小写
    return controllerName.toLowerCase();
  }

  /**
   * 从响应数据中提取资源 ID
   */
  private getResourceId(data: any): string | undefined {
    if (!data) return undefined;
    if (typeof data === 'object') {
      return data.id || data._id || data.data?.id || data.data?._id;
    }
    return undefined;
  }

  /**
   * 清理请求参数中的敏感字段
   * 将密码、密钥等敏感信息替换为 ***REDACTED***
   */
  private sanitizeParams(params: any): Record<string, any> | undefined {
    if (!params) return undefined;

    const sanitized = { ...params };
    const sensitiveFields = [
      'password',
      'passwordHash',
      'oldPassword',
      'newPassword',
      'token',
      'apiKey',
      'secret',
    ];

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '***REDACTED***';
      }
    }

    return sanitized;
  }
}
