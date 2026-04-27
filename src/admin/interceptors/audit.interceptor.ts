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

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: AuditLogService,
    private readonly reflector: Reflector,
    @Optional() private readonly auditAnchorPlugin?: AuditAnchorPlugin,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const method = request.method;

    const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const handlerName = context.getHandler().name;
    const controllerName = context.getClass().name.replace('Controller', '');

    // Check if this GET action should be audited (via descriptor config)
    const isAuditedGetAction =
      method === 'GET' &&
      this.auditAnchorPlugin?.shouldAuditGetAction(controllerName, handlerName);

    const shouldAudit = isWriteOperation || isAuditedGetAction;

    const startTime = Date.now();
    const action = `${controllerName}.${handlerName}`;
    const resource = this.resolveResourceType(controllerName);

    return next.handle().pipe(
      tap({
        next: (data) => {
          if (!shouldAudit) return;

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
        // For permission denied errors, always record audit log regardless of method
        const isPermissionError =
          error instanceof BusinessException &&
          (error.errorCode === ErrorCode.PERMISSION_DENIED ||
           error.errorCode === ErrorCode.INSUFFICIENT_PERMISSIONS);

        if (shouldAudit || isPermissionError) {
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
   * Resolve resource type dynamically via AuditAnchorPlugin,
   * falling back to lowercase controller name.
   */
  private resolveResourceType(controllerName: string): string {
    if (this.auditAnchorPlugin) {
      return this.auditAnchorPlugin.getResourceType(controllerName);
    }
    // Fallback for when plugin is not available
    return controllerName.toLowerCase();
  }

  private getResourceId(data: any): string | undefined {
    if (!data) return undefined;
    if (typeof data === 'object') {
      return data.id || data._id || data.data?.id || data.data?._id;
    }
    return undefined;
  }

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
