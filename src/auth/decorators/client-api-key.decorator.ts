import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 已鉴权请求解析出的 API 客户端主键（与 api_clients.apiKey 一致） */
export const ClientApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiKey || 'unknown';
  },
);
