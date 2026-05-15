import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditLog,
  AuditLogDocument,
} from '../database/schemas/audit-log.schema';
import { enrichAuditLogRecord } from './utils/enrich-audit-log.util';

export interface AuditLogData {
  action: string;
  operator: string;
  detail?: Record<string, any>;
  ip?: string;
  ipChain?: string[];
  forwardedForRaw?: string;
  operationKind?: string;
  resource?: string;
  resourceId?: string;
  result?: 'success' | 'failure';
  errorMessage?: string;
  requestParams?: Record<string, any>;
  userAgent?: string;
}

export interface AuditLogFilters {
  action?: string;
  operator?: string;
  resource?: string;
  /** 与列表「变动类型」一致：create / update / delete / reset / read / credit / other */
  operationKind?: string;
  result?: 'success' | 'failure';
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly logModel: Model<AuditLogDocument>,
  ) {}

  /**
   * 记录审计日志（增强版本，支持所有字段）
   */
  async log(data: AuditLogData): Promise<void>;
  async log(
    action: string,
    operator: string,
    detail?: Record<string, any>,
    ip?: string,
  ): Promise<void>;
  async log(
    actionOrData: string | AuditLogData,
    operator?: string,
    detail?: Record<string, any>,
    ip?: string,
  ): Promise<void> {
    let logData: AuditLogData;

    // 支持两种调用方式：新的对象参数和旧的位置参数
    if (typeof actionOrData === 'string') {
      logData = {
        action: actionOrData,
        operator: operator!,
        detail,
        ip,
      };
    } else {
      logData = actionOrData;
    }

    await this.logModel.create(logData);
  }

  /**
   * 查询审计日志（增强版本，支持更多过滤条件）
   */
  async list(
    filters: AuditLogFilters,
    page = 1,
    pageSize = 50,
  ) {
    const query: any = {};

    if (filters.action) {
      query.action = filters.action;
    }
    if (filters.operator) {
      query.operator = filters.operator;
    }
    if (filters.resource) {
      query.resource = filters.resource;
    }
    if (filters.operationKind) {
      query.$or = [
        { operationKind: filters.operationKind },
        { 'detail.operationKind': filters.operationKind },
      ];
    }
    if (filters.result) {
      query.result = filters.result;
    }
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = filters.startDate;
      }
      if (filters.endDate) {
        query.createdAt.$lte = filters.endDate;
      }
    }

    const [rawItems, total] = await Promise.all([
      this.logModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      this.logModel.countDocuments(query),
    ]);

    const items = rawItems.map((row) => enrichAuditLogRecord(row as Record<string, any>));

    return { items, total, page, pageSize };
  }

  /**
   * 记录权限检查失败
   */
  async logPermissionDenied(
    operator: string,
    action: string,
    requiredPermissions: string[],
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: 'permission_check_failed',
      operator,
      resource: 'permission',
      result: 'failure',
      errorMessage: `权限不足: 需要权限 ${requiredPermissions.join(', ')}`,
      detail: {
        attemptedAction: action,
        requiredPermissions,
      },
      ip,
      userAgent,
    });
  }
}
