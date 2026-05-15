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
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { AuditAnchorPlugin } from '../plugins/audit-anchor.plugin';
import { resolveClientIp } from '../../common/utils/client-ip.util';

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
    /** 审计锚点插件（可选注入，插件未注册时降级为默认行为） */
    @Optional() private readonly auditAnchorPlugin?: AuditAnchorPlugin,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest();
    const path = typeof request?.path === 'string' ? request.path : '';
    const method = request.method;
    if (!path.startsWith('/api/v1/admin')) {
      return next.handle();
    }
    /** 登录成功/失败均不写入审计（避免密码相关流量落库、减少噪音） */
    if (method === 'POST' && path === '/api/v1/admin/auth/login') {
      return next.handle();
    }

    const user = request.user;

    const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const handlerName = context.getHandler().name;
    const controllerName = context.getClass().name.replace('Controller', '');

    const isAuditedGetAction =
      method === 'GET' &&
      this.auditAnchorPlugin?.shouldAuditGetAction(controllerName, handlerName);

    const shouldAudit = isWriteOperation || isAuditedGetAction;

    const startTime = Date.now();
    const action = `${controllerName}.${handlerName}`;
    const resource = this.resolveResourceType(controllerName);
    const operationKind = this.inferOperationKind(method, handlerName);
    const ipInfo = resolveClientIp(request);

    return next.handle().pipe(
      tap({
        next: (data) => {
          if (!shouldAudit) return;

          const requestParams = this.buildRequestParams(request);
          const detail: Record<string, any> = {
            duration: Date.now() - startTime,
            method,
            path: request.path,
            operationKind,
            ipChain: ipInfo.ipChain,
            forwardedForRaw: ipInfo.forwardedForRaw,
            remoteAddress: ipInfo.remoteAddress,
          };
          if (isWriteOperation && data != null) {
            detail.responseSummary = this.summarizeResponse(data);
          }

          if (Object.keys(request.params || {}).length > 0) {
            detail.pathParams = { ...request.params };
          }

          this.auditService.log({
            action,
            operator: user?.username || 'anonymous',
            ip: ipInfo.clientIp,
            ipChain: ipInfo.ipChain,
            forwardedForRaw: ipInfo.forwardedForRaw,
            operationKind,
            resource,
            resourceId: this.getResourceId(data, request),
            result: 'success',
            requestParams,
            userAgent: request.headers['user-agent'],
            detail,
          });
        },
      }),
      catchError((error) => {
        const isPermissionError =
          error instanceof BusinessException &&
          (error.errorCode === ErrorCode.PERMISSION_DENIED ||
            error.errorCode === ErrorCode.INSUFFICIENT_PERMISSIONS);

        if (shouldAudit || isPermissionError) {
          const requestParams = this.buildRequestParams(request);
          const detail: Record<string, any> = {
            duration: Date.now() - startTime,
            method,
            path: request.path,
            operationKind,
            ipChain: ipInfo.ipChain,
            forwardedForRaw: ipInfo.forwardedForRaw,
            remoteAddress: ipInfo.remoteAddress,
            statusCode: error.status || 500,
            errorCode: error instanceof BusinessException ? error.errorCode : undefined,
          };

          if (Object.keys(request.params || {}).length > 0) {
            detail.pathParams = { ...request.params };
          }

          this.auditService.log({
            action,
            operator: user?.username || 'anonymous',
            ip: ipInfo.clientIp,
            ipChain: ipInfo.ipChain,
            forwardedForRaw: ipInfo.forwardedForRaw,
            operationKind,
            resource,
            resourceId: this.getResourceId(undefined, request),
            result: 'failure',
            errorMessage: error.message,
            requestParams,
            userAgent: request.headers['user-agent'],
            detail,
          });
        }

        return throwError(() => error);
      }),
    );
  }

  private inferOperationKind(method: string, handlerName: string): string {
    const h = handlerName.toLowerCase();
    if (h.includes('credit') || h.includes('recharge') || h.includes('topup')) {
      return 'credit';
    }
    if (method === 'DELETE') return 'delete';
    if (method === 'PUT' || method === 'PATCH') return 'update';
    if (method === 'POST') {
      if (h.includes('reset')) return 'reset';
      return 'create';
    }
    if (method === 'GET') return 'read';
    return 'other';
  }

  /**
   * 合并 body 与 query（脱敏），便于审计「涉及哪些入参」。
   */
  private buildRequestParams(request: any): Record<string, any> | undefined {
    const body = this.sanitizeParams(request.body);
    const query =
      request.query && typeof request.query === 'object' && Object.keys(request.query).length > 0
        ? this.sanitizeParams(request.query)
        : undefined;
    if (!body && !query) return undefined;
    const merged: Record<string, any> = {};
    if (body) merged.body = body;
    if (query) merged.query = query;
    return merged;
  }

  /** 响应体浅层摘要，避免整包落库过大；密钥类字段不落库明文 */
  private summarizeResponse(data: any, depth = 0): any {
    if (depth > 2 || data == null) return data;
    if (typeof data !== 'object') return data;
    if (Array.isArray(data)) {
      return { _type: 'array', length: data.length };
    }
    const keys = Object.keys(data).slice(0, 48);
    const out: Record<string, any> = {};
    for (const k of keys) {
      if (this.isSensitiveSummaryKey(k)) {
        out[k] = '***REDACTED***';
        continue;
      }
      const v = (data as any)[k];
      if (v != null && typeof v === 'object' && !Array.isArray(v) && depth < 2) {
        out[k] = this.summarizeResponse(v, depth + 1);
      } else if (Array.isArray(v)) {
        out[k] = { _type: 'array', length: v.length };
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /** 审计摘要中禁止写入明文的字段名（含嵌套 key） */
  private isSensitiveSummaryKey(key: string): boolean {
    const n = key.toLowerCase().replace(/_/g, '');
    if (
      n === 'apikey' ||
      n === 'plainkey' ||
      n === 'secret' ||
      n === 'secrethash' ||
      n === 'password' ||
      n === 'passwordhash' ||
      n === 'token' ||
      n === 'accesstoken' ||
      n === 'refreshtoken' ||
      n === 'authorization'
    ) {
      return true;
    }
    return n.includes('password') || n.includes('secret') || n.endsWith('token');
  }

  private resolveResourceType(controllerName: string): string {
    if (this.auditAnchorPlugin) {
      return this.auditAnchorPlugin.getResourceType(controllerName);
    }
    return controllerName.toLowerCase();
  }

  private getResourceId(data: any, request: any): string | undefined {
    const pick = (obj: Record<string, unknown> | undefined, keys: string[]) => {
      if (!obj) return undefined;
      for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          return String(v);
        }
      }
      return undefined;
    };

    const fromParams = pick(request?.params, [
      'apiKey',
      'taskId',
      'id',
      'key',
      'model_id',
    ]);
    if (fromParams) return fromParams;

    if (!data) return undefined;
    if (typeof data === 'object') {
      const inner = (data as any).data;
      if (inner && typeof inner === 'object') {
        const nested =
          inner.apiKey ??
          inner.id ??
          inner._id ??
          (inner as any).model_id;
        if (nested !== undefined && nested !== null) return String(nested);
      }
      const id = (data as any).id || (data as any)._id;
      if (id) return String(id);
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
      'plainKey',
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
