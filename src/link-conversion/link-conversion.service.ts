import { Injectable, Logger } from '@nestjs/common';
import { LinkConversionConfigService } from '../admin/link-conversion-config.service';
import { LinkConversionConfig } from '../admin/link-conversion-config.types';
import { ErrorLogger } from '../common/utils/error-logger.util';
import type { StoragesvcUploadContext } from './interfaces/storage-adapter.interface';
import { createLinkConversionStorageAdapter } from './adapters/akool-storagesvc.adapter';

/**
 * 链接转换结果
 */
export interface LinkConversionResult {
  /** 原始 URL */
  originalUrl: string;
  /** 转换后的 URL（如果转换成功） */
  convertedUrl?: string;
  /** 是否进行了转换 */
  converted: boolean;
  /** 转换失败原因（如果有） */
  error?: string;
}

/**
 * 链接转换服务 - 将三方资源 URL 转存为自有存储链接。
 *
 * 创建任务接口不对 request input 做转存；仅在任务成功终态后，
 * 对供应商返回的 {@link processResultPayload | resultPayload} 转存（业务回调前由 resource-metadata 队列执行）。
 */
@Injectable()
export class LinkConversionService {
  private readonly logger = new Logger(LinkConversionService.name);

  constructor(
    private readonly configService: LinkConversionConfigService,
  ) {}

  /**
   * 将任务结果中的三方资源 URL 转存为自有存储链接。
   * 供任务终态后置队列在触发业务回调之前调用，避免下游再依赖厂商临时链接。
   *
   * 支持供应商常见形态：顶层字符串 URL、URL 数组、或任意嵌套对象（凡值为裸 http(s) 字符串均尝试转存，由域名白名单与内容类型约束）。
   */
  async processResultPayload(
    resultPayload: unknown,
    taskId?: string,
  ): Promise<{ payload: unknown; changed: boolean }> {
    if (resultPayload == null) {
      return { payload: resultPayload, changed: false };
    }

    const config = await this.configService.getEffectiveConfig();
    if (!config.enabled) {
      return { payload: resultPayload, changed: false };
    }

    this.logger.debug(`Processing result link conversion for task ${taskId || 'unknown'}`);

    const results: LinkConversionResult[] = [];

    if (typeof resultPayload === 'string') {
      if (!this.isBareHttpUrlString(resultPayload)) {
        return { payload: resultPayload, changed: false };
      }
      const r = await this.convertUrl(resultPayload, config, taskId);
      results.push(r);
      this.logResultConversionSummary(results, taskId);
      return {
        payload: r.converted && r.convertedUrl ? r.convertedUrl : resultPayload,
        changed: r.converted,
      };
    }

    if (Array.isArray(resultPayload)) {
      const processed = JSON.parse(JSON.stringify(resultPayload)) as unknown[];
      await this.processResultArray(processed as any[], config, results, taskId);
      this.logResultConversionSummary(results, taskId);
      return { payload: processed, changed: results.some((r) => r.converted) };
    }

    if (typeof resultPayload !== 'object') {
      return { payload: resultPayload, changed: false };
    }

    const processed = JSON.parse(JSON.stringify(resultPayload)) as Record<string, any>;
    await this.processObject(processed, config, results, taskId);
    this.logResultConversionSummary(results, taskId);
    return { payload: processed, changed: results.some((r) => r.converted) };
  }

  private logResultConversionSummary(results: LinkConversionResult[], taskId?: string): void {
    const convertedCount = results.filter((r) => r.converted).length;
    const failedCount = results.filter((r) => r.error).length;
    if (convertedCount > 0 || failedCount > 0) {
      this.logger.log(
        `Result link conversion for task ${taskId || 'unknown'}: `
        + `${convertedCount} converted, ${failedCount} failed, ${results.length} total URLs`,
      );
    }
  }

  /** 结果里需要尝试转存的 http(s) 字符串（整段为 URL，非正文内嵌链接） */
  private isBareHttpUrlString(s: string): boolean {
    return /^https?:\/\//i.test(s) && this.isValidUrl(s);
  }

  private async processResultArray(
    arr: any[],
    config: LinkConversionConfig,
    results: LinkConversionResult[],
    taskId?: string,
  ): Promise<void> {
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (typeof el === 'string' && this.isBareHttpUrlString(el)) {
        const result = await this.convertUrl(el, config, taskId);
        results.push(result);
        if (result.converted && result.convertedUrl) {
          arr[i] = result.convertedUrl;
        }
      } else if (Array.isArray(el)) {
        await this.processResultArray(el, config, results, taskId);
      } else if (typeof el === 'object' && el !== null) {
        await this.processObject(el, config, results, taskId);
      }
    }
  }

  /**
   * 递归处理对象中的 URL 参数
   */
  private async processObject(
    obj: Record<string, any>,
    config: LinkConversionConfig,
    results: LinkConversionResult[],
    taskId?: string,
  ): Promise<void> {
    for (const key of Object.keys(obj)) {
      const value = obj[key];

      if (typeof value === 'string' && this.isBareHttpUrlString(value)) {
        const result = await this.convertUrl(value, config, taskId);
        results.push(result);
        if (result.converted && result.convertedUrl) {
          obj[key] = result.convertedUrl;
        }
      } else if (Array.isArray(value)) {
        await this.processResultArray(value, config, results, taskId);
      } else if (typeof value === 'object' && value !== null) {
        // 递归处理嵌套对象
        await this.processObject(value, config, results, taskId);
      }
    }
  }

  /**
   * 转换单个 URL
   */
  private async convertUrl(
    url: string,
    config: LinkConversionConfig,
    taskId?: string,
  ): Promise<LinkConversionResult> {
    const result: LinkConversionResult = {
      originalUrl: url,
      converted: false,
    };

    // 检查是否是有效的 URL
    if (!this.isValidUrl(url)) {
      return result;
    }

    // 检查是否是三方链接（不在白名单中的域名）
    if (!this.isThirdPartyUrl(url, config.domain_whitelist)) {
      this.logger.debug(`URL is not third-party, skipping: ${url}`);
      return result;
    }

    this.logger.debug(`Converting third-party URL: ${url}`);

    try {
      // 下载资源
      const { buffer, contentType } = await this.downloadResource(url, config.timeout.download_ms);

      // 检查资源类型
      if (!this.isAllowedContentType(contentType, config.resource_filters.allowed_types)) {
        result.error = `Content type ${contentType} not allowed`;
        this.logger.warn(`Skipping URL ${url}: content type ${contentType} not in allowed types`);
        return result;
      }

      // 检查资源大小
      const resourceType = this.getResourceType(contentType);
      const maxSize = config.resource_filters.max_size_bytes[resourceType] || config.resource_filters.max_size_bytes.image;
      if (buffer.length > maxSize) {
        result.error = `Resource size ${buffer.length} exceeds max ${maxSize}`;
        this.logger.warn(`Skipping URL ${url}: size ${buffer.length} exceeds max ${maxSize}`);
        return result;
      }

      // 生成存储键
      const storageKey = this.generateStorageKey(config.storage_config.path_prefix, contentType);

      // 上传到自有存储
      const convertedUrl = await this.uploadToStorage(buffer, storageKey, contentType, config);

      result.converted = true;
      result.convertedUrl = convertedUrl;
      this.logger.log(`Successfully converted URL: ${url} -> ${convertedUrl}`);

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      ErrorLogger.logError(
        this.logger,
        error instanceof Error ? error : new Error(String(error)),
        { url, taskId },
        'Failed to convert URL',
      );

      // 根据失败策略决定是否使用原始 URL
      if (config.failure_policy === 'fail_fast') {
        throw error;
      }
      // failure_policy === 'use_original' 时，使用原始 URL
    }

    return result;
  }

  /**
   * 检查是否是有效的 URL
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查是否是三方 URL（不在白名单中）
   */
  private isThirdPartyUrl(url: string, whitelist: string[]): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      // 检查是否在白名单中
      for (const pattern of whitelist) {
        if (this.matchDomainPattern(hostname, pattern.toLowerCase())) {
          return false; // 在白名单中，不是三方链接
        }
      }

      return true; // 不在白名单中，是三方链接
    } catch {
      return false;
    }
  }

  /**
   * 匹配域名模式（支持 * 通配符）
   */
  private matchDomainPattern(hostname: string, pattern: string): boolean {
    if (pattern === '*') return true;

    // 移除协议前缀
    pattern = pattern.replace(/^https?:\/\//, '');

    // 精确匹配
    if (hostname === pattern) return true;

    // 通配符匹配 *.example.com
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // .example.com
      return hostname.endsWith(suffix);
    }

    return false;
  }

  /**
   * 下载资源
   */
  private async downloadResource(
    url: string,
    timeoutMs: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const axios = require('axios');

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      maxContentLength: 16 * 1024 * 1024 * 1024, // 16GB
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const buffer = Buffer.from(response.data);

    return { buffer, contentType };
  }

  /**
   * 检查内容类型是否允许
   */
  private isAllowedContentType(contentType: string, allowedTypes: string[]): boolean {
    const normalizedContentType = contentType.toLowerCase().split(';')[0].trim();

    for (const pattern of allowedTypes) {
      if (pattern === '*/*') return true;
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (normalizedContentType.startsWith(prefix + '/')) return true;
      }
      if (normalizedContentType === pattern.toLowerCase()) return true;
    }

    return false;
  }

  /**
   * 根据内容类型获取资源类型
   */
  private getResourceType(contentType: string): 'image' | 'video' | 'audio' {
    const normalizedContentType = contentType.toLowerCase().split(';')[0].trim();

    if (normalizedContentType.startsWith('image/')) return 'image';
    if (normalizedContentType.startsWith('video/')) return 'video';
    if (normalizedContentType.startsWith('audio/')) return 'audio';

    // 默认返回 image
    return 'image';
  }

  /**
   * 生成存储键
   */
  private generateStorageKey(pathPrefix: string, contentType: string): string {
    const resourceType = this.getResourceType(contentType);
    const extension = this.getFileExtension(contentType);

    // 生成唯一文件名：pathPrefix + 资源类型 + 时间戳 + 随机数 + 扩展名
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const fileName = `${resourceType}_${timestamp}_${random}${extension}`;

    // 确保 pathPrefix 以 / 结尾
    const normalizedPrefix = pathPrefix.endsWith('/') ? pathPrefix : `${pathPrefix}/`;

    return `${normalizedPrefix}${resourceType}/${fileName}`;
  }

  /**
   * 根据内容类型获取文件扩展名
   */
  private getFileExtension(contentType: string): string {
    const normalizedContentType = contentType.toLowerCase().split(';')[0].trim();

    const extensionMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/quicktime': '.mov',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
    };

    return extensionMap[normalizedContentType] || '.bin';
  }

  /**
   * 上传到存储服务
   */
  private async uploadToStorage(
    buffer: Buffer,
    key: string,
    contentType: string,
    fullConfig: LinkConversionConfig,
  ): Promise<string> {
    const adapter = createLinkConversionStorageAdapter(fullConfig);
    const ctx: StoragesvcUploadContext = {
      fileExt: this.getFileExtension(contentType),
      contentType,
      bizType: fullConfig.storage_config.biz_type ?? 'model-hub-link-conversion',
      bizId: key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128),
      teamId: 'model-hub',
      uid: 0,
      bucket: fullConfig.storage_config.bucket,
      uploadTimeoutMs: fullConfig.timeout.upload_ms,
    };
    return adapter.upload(buffer, ctx);
  }
}
