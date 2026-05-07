import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  LinkConversionSettings,
  LinkConversionSettingsDocument,
} from '../database/schemas/link-conversion-settings.schema';
import {
  DEFAULT_LINK_CONVERSION_CONFIG,
  LINK_CONVERSION_CONFIG_CACHE_MS,
  LinkConversionConfig,
  LinkConversionFailurePolicy,
} from './link-conversion-config.types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: unknown,
): T {
  if (!isPlainObject(patch)) return { ...base };
  const out = { ...base } as Record<string, unknown>;
  for (const k of Object.keys(patch)) {
    const pv = (patch as Record<string, unknown>)[k];
    const bv = out[k];
    if (isPlainObject(pv) && isPlainObject(bv)) {
      out[k] = deepMerge(bv, pv);
    } else if (pv !== undefined) {
      out[k] = pv;
    }
  }
  return out as T;
}

@Injectable()
export class LinkConversionConfigService {
  private readonly logger = new Logger(LinkConversionConfigService.name);
  private cache: { config: LinkConversionConfig; loadedAt: number } | null =
    null;

  constructor(
    @InjectModel(LinkConversionSettings.name)
    private readonly model: Model<LinkConversionSettingsDocument>,
  ) {}

  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * 供运行时调用：带缓存的配置读取，默认缓存 60s，配置变更后 PUT 会立即 invalidate。
   */
  async getEffectiveConfig(): Promise<LinkConversionConfig> {
    const now = Date.now();
    if (
      this.cache &&
      now - this.cache.loadedAt < LINK_CONVERSION_CONFIG_CACHE_MS
    ) {
      return this.cache.config;
    }
    const row = await this.model
      .findOne({ config_key: 'global' })
      .lean()
      .exec();
    const merged = this.mergeWithDefaults(
      (row?.config as Record<string, unknown>) || {},
    );
    this.validateConfigOrThrow(merged);
    this.cache = { config: merged, loadedAt: now };
    return merged;
  }

  /** 管理端 GET：与 getEffectiveConfig 相同，但可强制跳过缓存 */
  async getForAdmin(options?: { bypassCache?: boolean }): Promise<{
    config: LinkConversionConfig;
    revision: number;
    updatedAt?: Date;
  }> {
    if (options?.bypassCache) this.invalidateCache();
    const row = await this.model
      .findOne({ config_key: 'global' })
      .lean()
      .exec();
    const merged = this.mergeWithDefaults(
      (row?.config as Record<string, unknown>) || {},
    );
    this.validateConfigOrThrow(merged);
    return {
      config: merged,
      revision: row?.revision ?? 0,
      updatedAt: (row as { updatedAt?: Date })?.updatedAt,
    };
  }

  async replaceConfig(
    body: unknown,
    _operator: string,
  ): Promise<{ revision: number }> {
    const merged = this.mergeWithDefaults(
      isPlainObject(body) ? body : {},
    );
    this.validateConfigOrThrow(merged);

    const updated = await this.model.findOneAndUpdate(
      { config_key: 'global' },
      {
        $set: { config: merged as unknown as Record<string, unknown> },
        $inc: { revision: 1 },
      },
      { upsert: true, new: true },
    );

    this.invalidateCache();
    this.logger.log(
      `Link conversion config updated, revision=${updated.revision}`,
    );
    return { revision: updated.revision };
  }

  mergeWithDefaults(patch: Record<string, unknown>): LinkConversionConfig {
    const base = JSON.parse(
      JSON.stringify(DEFAULT_LINK_CONVERSION_CONFIG),
    ) as unknown as Record<string, unknown>;
    return deepMerge(base, patch) as unknown as LinkConversionConfig;
  }

  validateConfigOrThrow(c: LinkConversionConfig): void {
    if (typeof c.enabled !== 'boolean') {
      throw new BadRequestException('enabled 必须为布尔值');
    }
    const t = c.timeout;
    if (!t || typeof t !== 'object') {
      throw new BadRequestException('timeout 配置无效');
    }
    const { download_ms, upload_ms, total_ms } = t;
    for (const [k, v] of Object.entries({
      download_ms,
      upload_ms,
      total_ms,
    })) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1000 || n > 3_600_000) {
        throw new BadRequestException(
          `timeout.${k} 必须为 1000～3600000 之间的数字（毫秒）`,
        );
      }
    }
    if (c.timeout.total_ms < c.timeout.download_ms) {
      throw new BadRequestException('total_ms 不得小于 download_ms');
    }
    if (c.timeout.total_ms < c.timeout.upload_ms) {
      throw new BadRequestException('total_ms 不得小于 upload_ms');
    }

    if (!Array.isArray(c.domain_whitelist)) {
      throw new BadRequestException('domain_whitelist 必须为字符串数组');
    }
    for (const d of c.domain_whitelist) {
      if (typeof d !== 'string' || !d.trim()) {
        throw new BadRequestException('domain_whitelist 含无效项');
      }
    }
    if (c.enabled && c.domain_whitelist.length === 0) {
      throw new BadRequestException(
        '启用链接转换时，请至少配置一个第三方域名白名单项',
      );
    }

    if (!Array.isArray(c.resource_filters?.allowed_types)) {
      throw new BadRequestException('resource_filters.allowed_types 必须为数组');
    }
    for (const t of c.resource_filters.allowed_types) {
      if (typeof t !== 'string' || !t.trim()) {
        throw new BadRequestException('allowed_types 含无效项');
      }
    }
    const ms = c.resource_filters.max_size_bytes;
    if (!ms || typeof ms !== 'object') {
      throw new BadRequestException('resource_filters.max_size_bytes 无效');
    }
    for (const k of ['image', 'video', 'audio'] as const) {
      const n = Number(ms[k]);
      if (!Number.isFinite(n) || n < 1024 || n > 16 * 1024 * 1024 * 1024) {
        throw new BadRequestException(
          `max_size_bytes.${k} 必须为 1024～16GB 之间的整数`,
        );
      }
    }

    const sc = c.storage_config;
    if (!sc?.bucket?.trim() || !sc.path_prefix?.trim()) {
      throw new BadRequestException(
        'storage_config.bucket、path_prefix 均不能为空',
      );
    }

    const fp = c.failure_policy as LinkConversionFailurePolicy;
    if (fp !== 'fail_fast' && fp !== 'use_original') {
      throw new BadRequestException(
        'failure_policy 必须为 fail_fast 或 use_original',
      );
    }

    const rc = c.retry_config;
    const maxA = Number(rc?.max_attempts);
    if (!Number.isInteger(maxA) || maxA < 1 || maxA > 20) {
      throw new BadRequestException('retry_config.max_attempts 须为 1～20 的整数');
    }
    const bf = Number(rc?.backoff_factor);
    if (!Number.isFinite(bf) || bf < 1 || bf > 10) {
      throw new BadRequestException('retry_config.backoff_factor 须为 1～10');
    }
    const id = Number(rc?.initial_delay_ms);
    if (!Number.isFinite(id) || id < 0 || id > 300_000) {
      throw new BadRequestException(
        'retry_config.initial_delay_ms 须为 0～300000',
      );
    }

    const th = Number(c.monitoring?.failure_rate_threshold);
    if (!Number.isFinite(th) || th < 0 || th > 1) {
      throw new BadRequestException(
        'monitoring.failure_rate_threshold 须为 0～1 之间的小数',
      );
    }
    if (!Array.isArray(c.monitoring.alert_channels)) {
      throw new BadRequestException('monitoring.alert_channels 必须为数组');
    }
    if (!Array.isArray(c.monitoring.alert_recipients)) {
      throw new BadRequestException('monitoring.alert_recipients 必须为数组');
    }

    const st = c.storagesvc;
    if (!st || typeof st !== 'object') {
      throw new BadRequestException('storagesvc 配置无效');
    }
    if (c.enabled) {
      if (!st.host?.trim()) {
        throw new BadRequestException('启用链接转换时须配置 storagesvc.host');
      }
      if (!st.jwt_secret?.trim()) {
        throw new BadRequestException('启用链接转换时须配置 storagesvc.jwt_secret');
      }
    }
    if (st.timeout_ms !== undefined && st.timeout_ms !== null) {
      const tm = Number(st.timeout_ms);
      if (!Number.isFinite(tm) || tm < 1000 || tm > 120_000) {
        throw new BadRequestException(
          'storagesvc.timeout_ms 须为 1000～120000 之间的数字（毫秒）或未设置',
        );
      }
    }
    if (st.cdn_domain_list !== undefined && !Array.isArray(st.cdn_domain_list)) {
      throw new BadRequestException('storagesvc.cdn_domain_list 必须为字符串数组');
    }
    if (Array.isArray(st.cdn_domain_list)) {
      for (const d of st.cdn_domain_list) {
        if (typeof d !== 'string' || !d.trim()) {
          throw new BadRequestException('storagesvc.cdn_domain_list 含无效项');
        }
      }
    }
  }
}
