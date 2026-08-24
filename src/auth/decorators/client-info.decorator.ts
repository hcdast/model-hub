import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * 获取客户端信息（支持 API Key 和 JWT Token 两种认证方式）
 */
export interface ClientInfo {
  /** API Key（如果有） */
  apiKey?: string;
  /** 是否是 Portal 用户 */
  isPortalUser?: boolean;
  /** 用户 ID（Portal 用户） */
  userId?: string;
  /** 用户邮箱（Portal 用户） */
  email?: string;
  /** 用户名（Portal 用户） */
  username?: string;
  /** 用户角色（Portal 用户） */
  role?: string;
  /** 客户端名称（API Client） */
  name?: string;
  /** 认证主体类型 */
  subjectType?: 'admin-client' | 'portal-api-key' | 'portal-user';
  /** 认证主体 ID */
  subjectId?: string;
}

interface AuthenticatedClientRequest extends Request {
  apiClient?: ClientInfo;
}

/**
 * 获取客户端信息装饰器
 * 使用方式: @Client() client: ClientInfo
 */
export const Client = createParamDecorator(
  (data: keyof ClientInfo | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedClientRequest>();
    const client = request.apiClient;

    if (!client) {
      return null;
    }

    return data ? client[data] : client;
  },
);

/**
 * 获取客户端标识（用于创建/查询资源）
 * 优先使用 userId，其次使用 apiKey
 */
export const ClientId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedClientRequest>();
    const client = request.apiClient;

    if (!client) {
      return null;
    }

    // 优先返回 userId（Portal 用户）
    return client.userId || client.apiKey || null;
  },
);
