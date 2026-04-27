import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ModelRoutingRule,
  ModelRoutingRuleDocument,
} from '../database/schemas/model-routing-rule.schema';

export interface RoutingRuleHit {
  provider: string;
  /** Mongo _id，写入 task.routeId */
  routeId: string;
  strategy_type: string;
}

type LeanRule = ModelRoutingRule & { _id?: { toString: () => string } };

@Injectable()
export class ProviderRoutingService {
  private readonly logger = new Logger(ProviderRoutingService.name);

  constructor(
    @InjectModel(ModelRoutingRule.name)
    private readonly ruleModel: Model<ModelRoutingRuleDocument>,
  ) {}

  /**
   * 若存在生效的路由规则（fixed / weighted / primary_fallback），返回解析结果；
   * 否则返回 null，由调用方走 model_configs.service 等兜底逻辑。
   */
  async tryResolveFromRules(
    modelName: string,
    clientId: string,
    at: Date = new Date(),
  ): Promise<RoutingRuleHit | null> {
    const rules = (await this.ruleModel
      .find({
        model_name: modelName,
        enabled: true,
        strategy_type: { $in: ['fixed', 'weighted', 'primary_fallback'] },
      })
      .lean()
      .exec()) as LeanRule[];

    if (!rules.length) return null;

    const candidates = rules
      .filter((r) => this.isEffective(r, at))
      .filter((r) => this.clientMatches(r, clientId))
      .filter((r) => this.canResolveRule(r));

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      const spec = this.specificityScore(b, clientId) - this.specificityScore(a, clientId);
      if (spec !== 0) return spec;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });

    const top = candidates[0];
    const routeId = top._id ? top._id.toString() : '';
    const seed = `${clientId}\u001c${modelName}\u001c${routeId}`;

    const provider = this.resolveProviderForRule(top, seed);
    if (!provider) return null;

    this.logger.debug(
      `Routing rule hit: model=${modelName} client=${clientId} strategy=${top.strategy_type} → provider=${provider} routeId=${routeId}`,
    );

    return {
      provider,
      routeId,
      strategy_type: top.strategy_type,
    };
  }

  private resolveProviderForRule(r: LeanRule, seed: string): string | null {
    switch (r.strategy_type) {
      case 'fixed': {
        const p = r.fixed_provider?.trim();
        return p || null;
      }
      case 'weighted': {
        const targets = this.normalizeWeightedTargets(r.weighted_targets);
        if (!targets.length) return null;
        return this.pickWeighted(targets, seed);
      }
      case 'primary_fallback': {
        const targets = this.buildPrimaryFallbackTargets(r);
        if (!targets.length) return null;
        return this.pickWeighted(targets, seed);
      }
      default:
        return null;
    }
  }

  /** 规则是否具备解析所需字段 */
  private canResolveRule(r: LeanRule): boolean {
    switch (r.strategy_type) {
      case 'fixed':
        return Boolean(r.fixed_provider?.trim());
      case 'weighted': {
        const t = this.normalizeWeightedTargets(r.weighted_targets);
        return t.length > 0 && t.reduce((s, x) => s + x.weight, 0) > 0;
      }
      case 'primary_fallback':
        return this.buildPrimaryFallbackTargets(r).length > 0;
      default:
        return false;
    }
  }

  private normalizeWeightedTargets(
    raw: ModelRoutingRule['weighted_targets'] | undefined,
  ): { provider: string; weight: number }[] {
    if (!Array.isArray(raw)) return [];
    const out: { provider: string; weight: number }[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const provider = String((item as { provider?: string }).provider ?? '').trim();
      const w = Number((item as { weight?: number }).weight);
      if (!provider || !Number.isFinite(w) || w <= 0) continue;
      out.push({ provider, weight: w });
    }
    return out;
  }

  private buildPrimaryFallbackTargets(r: LeanRule): { provider: string; weight: number }[] {
    const primary = r.primary_provider?.trim();
    if (!primary) return [];
    const fallback = r.fallback_provider?.trim();
    const pw = r.primary_weight != null ? Number(r.primary_weight) : 100;
    const fw = r.fallback_weight != null ? Number(r.fallback_weight) : 0;

    if (!fallback) {
      return [{ provider: primary, weight: Math.max(pw, 1) }];
    }
    if (!Number.isFinite(pw) || !Number.isFinite(fw) || pw < 0 || fw < 0) {
      return [];
    }
    /** 未给备流量时仅走主（与「仅填 primary」一致） */
    if (fw <= 0) {
      return [{ provider: primary, weight: Math.max(pw, 1) }];
    }
    if (pw + fw <= 0) return [];
    return [
      { provider: primary, weight: pw },
      { provider: fallback, weight: fw },
    ];
  }

  /**
   * 稳定哈希分流：同一 client + model + 规则下每次请求落到同一 provider。
   */
  private pickWeighted(targets: { provider: string; weight: number }[], seed: string): string {
    const sum = targets.reduce((s, t) => s + t.weight, 0);
    if (sum <= 0) return targets[0].provider;

    let bucket = this.stableBucket(seed, sum);
    for (const t of targets) {
      if (bucket < t.weight) return t.provider;
      bucket -= t.weight;
    }
    return targets[targets.length - 1].provider;
  }

  /** 0 .. modulo-1 */
  private stableBucket(seed: string, modulo: number): number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % modulo;
  }

  private isEffective(r: LeanRule, at: Date): boolean {
    if (r.effective_from && at < new Date(r.effective_from)) return false;
    if (r.effective_until && at > new Date(r.effective_until)) return false;
    return true;
  }

  private clientMatches(r: LeanRule, clientId: string): boolean {
    const rid = (r.client_id ?? '').trim();
    if (rid === '') return true;
    return rid === clientId;
  }

  private specificityScore(r: LeanRule, clientId: string): number {
    const rid = (r.client_id ?? '').trim();
    if (rid !== '' && rid === clientId) return 1;
    return 0;
  }
}
