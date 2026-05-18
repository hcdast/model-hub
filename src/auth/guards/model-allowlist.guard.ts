import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import { ApiClient, ApiClientDocument } from '../../database/schemas/api-client.schema';

/**
 * 模型白名单 Guard
 *
 * 在 ApiKeyGuard 和 ClientRateLimitGuard 之后执行，检查请求的 model 是否在客户端的 modelAllowlist 中：
 * - 空 allowlist 放行所有模型（向后兼容）
 * - 支持通配符匹配（`*` 匹配任意字符序列，包括 `/`）
 * - 不匹配返回 HTTP 403 + MODEL_NOT_ALLOWED
 */
@Injectable()
export class ModelAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(ModelAllowlistGuard.name);

  constructor(
    @InjectModel(ApiClient.name) private readonly apiClientModel: Model<ApiClientDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = (request as any).apiKey as string;

    if (!apiKey) {
      // 没有 apiKey 说明 ApiKeyGuard 未执行或未设置，直接放行
      return true;
    }

    // Guards 在 ValidationPipe 之前执行，需同时读 model_id
    const raw = request.body?.model_id ?? request.body?.model;
    const model = raw != null ? String(raw).trim() : '';
    if (!model) {
      // 没有模型字段，放行（由后续 DTO 校验处理）
      return true;
    }

    // 获取客户端的模型白名单
    const allowlist = await this.getModelAllowlist(apiKey);

    // 空 allowlist 放行所有模型（向后兼容）
    if (!allowlist || allowlist.length === 0) {
      return true;
    }

    // 检查 model 是否匹配白名单中的任一模式
    const isAllowed = allowlist.some((pattern) => this.matchPattern(pattern, model));

    if (!isAllowed) {
      this.logger.warn(
        `模型访问被拒绝: apiKey=${apiKey}, model=${model}, allowlist=${JSON.stringify(allowlist)}`,
      );
      throw new HttpException(
        { success: false, error: 'Model not allowed', code: 'MODEL_NOT_ALLOWED' },
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }

  /**
   * 获取客户端的模型白名单配置
   */
  private async getModelAllowlist(apiKey: string): Promise<string[]> {
    const doc = await this.apiClientModel
      .findOne({ apiKey })
      .select('modelAllowlist')
      .lean()
      .exec();

    return doc?.modelAllowlist ?? [];
  }

  /**
   * 通配符模式匹配
   *
   * 将通配符模式转换为正则表达式进行匹配：
   * - `*` 匹配任意字符序列（包括 `/`），转换为正则 `.*`
   * - 其他特殊正则字符进行转义
   *
   * 示例：
   * - `wavespeed-ai/*` 匹配 `wavespeed-ai/flux-2-pro/text-to-image`
   * - `openai/gpt-4*` 匹配 `openai/gpt-4`, `openai/gpt-4-turbo`
   */
  matchPattern(pattern: string, model: string): boolean {
    // 将通配符模式转换为正则表达式
    const regexStr = pattern
      // 转义正则特殊字符（除了 *）
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      // 将 * 转换为 .*
      .replace(/\*/g, '.*');

    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(model);
  }
}
