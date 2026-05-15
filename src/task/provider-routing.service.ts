import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ModelRoutingRule,
  ModelRoutingRuleDocument,
} from '../database/schemas/model-routing-rule.schema';
import {
  ProviderRuntimeConfig,
  ProviderRuntimeConfigDocument,
} from '../database/schemas/provider-runtime-config.schema';
import { CircuitBreakerService } from '../provider-health/circuit-breaker.service';
import { HealthMetricsCollector } from '../provider-health/health-metrics-collector.service';
import { MetricsService } from '../observability/metrics.service';
import { CircuitState } from '../provider-health/interfaces/circuit-breaker-state.interface';

export interface RoutingRuleHit {
  provider: string;
  /** Mongo _id，写入 task.routeId */
  routeId: string;
  strategy_type: string;
  /** 熔断触发的故障转移原因 */
  failoverReason?: string;
  /** 路由决策指标，latency/cost 策略解析时填充 */
  routingMetrics?: {
    selectedLatencyMs?: number;
    selectedCostPerUnit?: number;
    candidates?: { provider: string; latencyMs?: number; costPerUnit?: number }[];
  };
}

/** 单条规则在仿真中的评估结果（含未命中原因） */
export interface RoutingRuleEvaluationRow {
  ruleId: string;
  model_id: string;
  apiKey: string;
  enabled: boolean;
  priority: number;
  strategy_type: string;
  skipReasons: string[];
  isCandidate: boolean;
}

/** 路由规则仿真输出（不写 Prometheus 指标） */
export interface RoutingRuleSimulationResult {
  evaluations: RoutingRuleEvaluationRow[];
  candidateRuleIds: string[];
  winnerRuleId: string | null;
  hit: RoutingRuleHit | null;
  resolutionDebug: Record<string, unknown> | null;
}

const ROUTING_STRATEGIES = new Set(['fixed', 'weighted', 'primary_fallback', 'latency', 'cost']);

type LeanRule = ModelRoutingRule & { _id?: { toString: () => string } };

@Injectable()
export class ProviderRoutingService {
  private readonly logger = new Logger(ProviderRoutingService.name);

  /** UNKNOWN 状态 Provider 的默认延迟（毫秒），可通过配置覆盖 */
  private readonly defaultUnknownLatencyMs = 5000;

  /** 未配置 costPerUnit 时的默认高成本值，降低选择优先级 */
  private readonly defaultHighCost = 999999;

  constructor(
    @InjectModel(ModelRoutingRule.name)
    private readonly ruleModel: Model<ModelRoutingRuleDocument>,
    @InjectModel(ProviderRuntimeConfig.name)
    private readonly providerRuntimeConfigModel: Model<ProviderRuntimeConfigDocument>,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly healthMetricsCollector: HealthMetricsCollector,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * 若存在生效的路由规则（fixed / weighted / primary_fallback），返回解析结果；
   * 否则返回 null，由调用方走 model_configs.provider 等兜底逻辑。
   */
  async tryResolveFromRules(
    modelName: string,
    apiKey: string,
    at: Date = new Date(),
  ): Promise<RoutingRuleHit | null> {
    const rules = (await this.ruleModel
      .find({
        model_id: modelName,
        enabled: true,
        strategy_type: { $in: ['fixed', 'weighted', 'primary_fallback', 'latency', 'cost'] },
      })
      .lean()
      .exec()) as LeanRule[];

    if (!rules.length) return null;

    const candidates = rules
      .filter((r) => this.isEffective(r, at))
      .filter((r) => this.clientMatches(r, apiKey))
      .filter((r) => this.canResolveRule(r));

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      const spec = this.specificityScore(b, apiKey) - this.specificityScore(a, apiKey);
      if (spec !== 0) return spec;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });

    const top = candidates[0];
    const routeId = top._id ? top._id.toString() : '';
    const seed = `${apiKey}\u001c${modelName}\u001c${routeId}`;

    const result = await this.resolveProviderForRule(top, seed, undefined);
    if (!result) return null;

    this.logger.debug(
      `Routing rule hit: model=${modelName} client=${apiKey} strategy=${top.strategy_type} → provider=${result.provider} routeId=${routeId}${result.failoverReason ? ` failoverReason=${result.failoverReason}` : ''}`,
    );

    // 当发生熔断故障转移时，递增 failover 计数器
    if (result.failoverReason) {
      const primaryProvider = top.primary_provider?.trim() || '';
      this.metricsService.providerFailoverTotal
        .labels(primaryProvider, result.provider, modelName)
        .inc();
    }

    // 递增路由决策计数器
    this.metricsService.routingDecisionTotal
      .labels(top.strategy_type, result.provider, modelName)
      .inc();

    return {
      provider: result.provider,
      routeId,
      strategy_type: top.strategy_type,
      failoverReason: result.failoverReason,
      routingMetrics: result.routingMetrics,
    };
  }

  /**
   * 路由规则仿真：返回每条规则的命中/跳过原因、候选排序、与生产一致的解析结果；不递增业务指标。
   */
  async simulateFromRules(
    modelName: string,
    apiKey: string,
    at: Date = new Date(),
  ): Promise<RoutingRuleSimulationResult> {
    const rules = (await this.ruleModel
      .find({ model_id: modelName })
      .sort({ model_id: 1, priority: -1, apiKey: 1 })
      .lean()
      .exec()) as LeanRule[];

    const evaluations: RoutingRuleEvaluationRow[] = [];
    for (const r of rules) {
      const ruleId = r._id ? r._id.toString() : '';
      const skipReasons: string[] = [];
      if (!ROUTING_STRATEGIES.has(String(r.strategy_type))) {
        skipReasons.push(`不支持的策略类型: ${r.strategy_type}`);
      }
      if (r.enabled === false) {
        skipReasons.push('规则已停用');
      }
      if (!this.isEffective(r, at)) {
        skipReasons.push('当前时间不在生效时间窗内');
      }
      if (!this.clientMatches(r, apiKey)) {
        skipReasons.push('apiKey 限定不匹配（规则仅对指定 Key 生效）');
      }
      if (skipReasons.length === 0 && !this.canResolveRule(r)) {
        skipReasons.push('策略参数不完整，无法解析厂商');
      }
      const isCandidate =
        ROUTING_STRATEGIES.has(String(r.strategy_type)) &&
        r.enabled !== false &&
        this.isEffective(r, at) &&
        this.clientMatches(r, apiKey) &&
        this.canResolveRule(r);

      evaluations.push({
        ruleId,
        model_id: r.model_id,
        apiKey: (r.apiKey ?? '').trim(),
        enabled: r.enabled !== false,
        priority: r.priority ?? 0,
        strategy_type: String(r.strategy_type),
        skipReasons,
        isCandidate,
      });
    }

    const candidates = rules.filter((r) => {
      if (!ROUTING_STRATEGIES.has(String(r.strategy_type))) return false;
      if (r.enabled === false) return false;
      if (!this.isEffective(r, at)) return false;
      if (!this.clientMatches(r, apiKey)) return false;
      return this.canResolveRule(r);
    });

    candidates.sort((a, b) => {
      const spec = this.specificityScore(b, apiKey) - this.specificityScore(a, apiKey);
      if (spec !== 0) return spec;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });

    const candidateRuleIds = candidates.map((c) => (c._id ? c._id.toString() : '')).filter(Boolean);
    let winnerRuleId: string | null = null;
    let hit: RoutingRuleHit | null = null;
    let resolutionDebug: Record<string, unknown> | null = null;

    if (candidates.length) {
      const top = candidates[0];
      winnerRuleId = top._id ? top._id.toString() : null;
      const routeId = winnerRuleId || '';
      const seed = `${apiKey}\u001c${modelName}\u001c${routeId}`;
      const detail: Record<string, unknown> = { seed, modelName, apiKey };
      const result = await this.resolveProviderForRule(top, seed, detail);
      resolutionDebug = detail;
      if (result) {
        hit = {
          provider: result.provider,
          routeId,
          strategy_type: top.strategy_type,
          failoverReason: result.failoverReason,
          routingMetrics: result.routingMetrics,
        };
      }
    }

    return {
      evaluations,
      candidateRuleIds,
      winnerRuleId,
      hit,
      resolutionDebug,
    };
  }

  private async resolveProviderForRule(
    r: LeanRule,
    seed: string,
    detail: Record<string, unknown> | undefined,
  ): Promise<{ provider: string; failoverReason?: string; routingMetrics?: RoutingRuleHit['routingMetrics'] } | null> {
    switch (r.strategy_type) {
      case 'fixed': {
        const p = r.fixed_provider?.trim();
        if (detail) {
          detail.strategy = 'fixed';
          detail.fixed_provider = p;
        }
        return p ? { provider: p } : null;
      }
      case 'weighted': {
        const targets = this.normalizeWeightedTargets(r.weighted_targets);
        if (!targets.length) return null;

        // 过滤掉熔断状态为 OPEN 的 Provider
        const stateChecks = await Promise.all(
          targets.map(async (t) => ({
            ...t,
            state: await this.circuitBreakerService.getState(t.provider),
          })),
        );
        if (detail) {
          detail.strategy = 'weighted';
          detail.targets = targets;
          detail.circuitByProvider = Object.fromEntries(
            stateChecks.map((t) => [t.provider, t.state]),
          );
        }
        const available = stateChecks.filter(
          (t) => t.state !== CircuitState.OPEN,
        );

        // 所有 Provider 均为 OPEN 时返回 null
        if (!available.length) {
          this.logger.warn(
            `weighted 策略所有 Provider 均熔断 OPEN，无可用 Provider`,
          );
          if (detail) {
            detail.outcome = 'all_open';
          }
          return null;
        }

        // 在剩余 Provider 之间按原始权重分配
        const remainingTargets = available.map(({ provider, weight }) => ({
          provider,
          weight,
        }));
        const picked = this.pickWeighted(remainingTargets, seed);
        if (detail) {
          detail.remainingTargets = remainingTargets;
          detail.weightSum = remainingTargets.reduce((s, t) => s + t.weight, 0);
          detail.stableBucketModulo = detail.weightSum;
          detail.stableBucketValue =
            typeof detail.weightSum === 'number' && detail.weightSum > 0
              ? this.stableBucket(seed, detail.weightSum as number)
              : undefined;
          detail.pickedProvider = picked;
        }
        return { provider: picked };
      }
      case 'primary_fallback': {
        return this.resolvePrimaryFallbackWithCircuitBreaker(r, seed, detail);
      }
      case 'latency': {
        return this.resolveLatencyStrategy(r, seed, detail);
      }
      case 'cost': {
        return this.resolveCostStrategy(r, seed, detail);
      }
      default:
        return null;
    }
  }

  /**
   * primary_fallback 策略的熔断感知路由解析
   * - CLOSED 状态：正常走 primary
   * - OPEN 状态：直接选择 fallback，设置 failoverReason
   * - HALF_OPEN 状态：调用 allowRequest 判断是否允许探针
   */
  private async resolvePrimaryFallbackWithCircuitBreaker(
    r: LeanRule,
    seed: string,
    detail: Record<string, unknown> | undefined,
  ): Promise<{ provider: string; failoverReason?: string } | null> {
    const primary = r.primary_provider?.trim();
    if (!primary) return null;

    const fallback = r.fallback_provider?.trim();

    // 检查 primary provider 的熔断状态
    const state = await this.circuitBreakerService.getState(primary);
    if (detail) {
      detail.strategy = 'primary_fallback';
      detail.primary = primary;
      detail.fallback = fallback || null;
      detail.primaryCircuitState = state;
    }

    switch (state) {
      case CircuitState.OPEN: {
        // 熔断打开：直接选择 fallback
        if (fallback) {
          this.logger.warn(
            `Provider ${primary} 熔断器 OPEN，故障转移到 fallback: ${fallback}`,
          );
          if (detail) detail.branch = 'failover_open';
          return {
            provider: fallback,
            failoverReason: 'circuit_breaker_open',
          };
        }
        // 无 fallback 可用，返回 null
        this.logger.warn(
          `Provider ${primary} 熔断器 OPEN，但无 fallback 可用`,
        );
        if (detail) detail.branch = 'open_no_fallback';
        return null;
      }

      case CircuitState.HALF_OPEN: {
        // 半开状态：调用 allowRequest 判断是否允许探针请求
        const allowed = await this.circuitBreakerService.allowRequest(primary);
        if (detail) detail.halfOpenAllowRequest = allowed;
        if (allowed) {
          // 允许探针请求到达 primary
          this.logger.debug(
            `Provider ${primary} 熔断器 HALF_OPEN，允许探针请求`,
          );
          if (detail) detail.branch = 'half_open_primary';
          return { provider: primary };
        }
        // 探针配额已满，走 fallback
        if (fallback) {
          this.logger.debug(
            `Provider ${primary} 熔断器 HALF_OPEN 探针配额已满，故障转移到 fallback: ${fallback}`,
          );
          if (detail) detail.branch = 'half_open_failover';
          return {
            provider: fallback,
            failoverReason: 'circuit_breaker_open',
          };
        }
        if (detail) detail.branch = 'half_open_no_fallback';
        return null;
      }

      case CircuitState.CLOSED:
      default: {
        // 正常状态：走原有的 primary_fallback 权重逻辑
        const targets = this.buildPrimaryFallbackTargets(r);
        if (!targets.length) return null;
        const picked = this.pickWeighted(targets, seed);
        if (detail) {
          detail.branch = 'weighted_split';
          detail.weightTargets = targets;
          detail.weightSum = targets.reduce((s, t) => s + t.weight, 0);
          const sum = detail.weightSum as number;
          detail.stableBucketValue = sum > 0 ? this.stableBucket(seed, sum) : undefined;
          detail.pickedProvider = picked;
        }
        return { provider: picked };
      }
    }
  }

  /**
   * latency 策略解析：
   * 1. 获取所有 latency_targets 的健康指标
   * 2. 排除 CircuitState.OPEN 的 Provider
   * 3. UNKNOWN 状态（样本不足）赋予默认延迟 5000ms
   * 4. 选择 avgLatencyMs 最低的 Provider
   * 5. 所有延迟相等时 round-robin（基于 seed hash）
   * 6. 填充 routingMetrics 字段
   */
  private async resolveLatencyStrategy(
    r: LeanRule,
    seed: string,
    detail: Record<string, unknown> | undefined,
  ): Promise<{ provider: string; routingMetrics?: RoutingRuleHit['routingMetrics'] } | null> {
    const targets = (r.latency_targets ?? []).map(t => t.trim()).filter(Boolean);
    if (targets.length < 2) return null;

    // 并行获取所有 target 的熔断状态和健康指标
    const candidateData = await Promise.all(
      targets.map(async (provider) => {
        const [state, metrics] = await Promise.all([
          this.circuitBreakerService.getState(provider),
          this.healthMetricsCollector.getMetrics(provider),
        ]);
        return { provider, state, metrics };
      }),
    );

    if (detail) {
      detail.strategy = 'latency';
      detail.rawTargets = targets;
      detail.circuitByProvider = Object.fromEntries(candidateData.map((c) => [c.provider, c.state]));
      detail.metricsSample = candidateData.map((c) => ({
        provider: c.provider,
        sampleCount: c.metrics.sampleCount,
        avgLatencyMs: c.metrics.avgLatencyMs,
      }));
    }

    // 排除 CircuitState.OPEN 的 Provider
    const available = candidateData.filter(c => c.state !== CircuitState.OPEN);

    if (!available.length) {
      this.logger.warn('latency 策略所有 Provider 均熔断 OPEN，无可用 Provider');
      if (detail) detail.outcome = 'all_open';
      return null;
    }

    // 计算有效延迟：样本不足（UNKNOWN）时赋予默认延迟
    const withLatency = available.map(c => {
      const isUnknown = c.metrics.sampleCount < 10; // defaultMinSampleCount
      const latencyMs = isUnknown ? this.defaultUnknownLatencyMs : c.metrics.avgLatencyMs;
      return { provider: c.provider, latencyMs, usedDefaultLatency: isUnknown };
    });

    // 找到最低延迟值
    const minLatency = Math.min(...withLatency.map(c => c.latencyMs));

    // 筛选出延迟等于最低值的候选者
    const lowestCandidates = withLatency.filter(c => c.latencyMs === minLatency);

    let selectedProvider: string;
    let tieBreakIdx: number | undefined;
    if (lowestCandidates.length === 1) {
      selectedProvider = lowestCandidates[0].provider;
    } else {
      // 所有延迟相等时 round-robin（基于 seed hash）
      tieBreakIdx = this.stableBucket(seed, lowestCandidates.length);
      selectedProvider = lowestCandidates[tieBreakIdx].provider;
    }

    const selectedLatencyMs = withLatency.find(c => c.provider === selectedProvider)!.latencyMs;

    if (detail) {
      detail.effectiveLatencies = withLatency;
      detail.minLatencyMs = minLatency;
      detail.tieBreakPool = lowestCandidates.map((c) => c.provider);
      detail.tieBreakIndex = tieBreakIdx;
      detail.pickedProvider = selectedProvider;
    }

    // 构建 routingMetrics
    const routingMetrics: RoutingRuleHit['routingMetrics'] = {
      selectedLatencyMs,
      candidates: withLatency.map(c => ({
        provider: c.provider,
        latencyMs: c.latencyMs,
      })),
    };

    return { provider: selectedProvider, routingMetrics };
  }

  /**
   * cost 策略解析：
   * 1. 获取所有 cost_targets 的 costPerUnit（缺失时回退到 provider_runtime_configs.cost_config）
   * 2. 排除 CircuitState.OPEN 的 Provider
   * 3. 选择 costPerUnit 最低的 Provider
   * 4. 成本相同时用 avgLatencyMs 作为 tiebreaker（选延迟更低的）
   * 5. 填充 routingMetrics 字段
   */
  private async resolveCostStrategy(
    r: LeanRule,
    seed: string,
    detail: Record<string, unknown> | undefined,
  ): Promise<{ provider: string; routingMetrics?: RoutingRuleHit['routingMetrics'] } | null> {
    const costTargets = (r.cost_targets ?? []).filter(t => t?.provider?.trim());
    if (!costTargets.length) return null;

    // 并行获取所有 target 的熔断状态和健康指标
    const candidateData = await Promise.all(
      costTargets.map(async (target) => {
        const provider = target.provider.trim();
        const [state, metrics] = await Promise.all([
          this.circuitBreakerService.getState(provider),
          this.healthMetricsCollector.getMetrics(provider),
        ]);
        return { provider, costPerUnit: target.costPerUnit, state, metrics };
      }),
    );

    if (detail) {
      detail.strategy = 'cost';
      detail.circuitByProvider = Object.fromEntries(candidateData.map((c) => [c.provider, c.state]));
    }

    // 排除 CircuitState.OPEN 的 Provider
    const available = candidateData.filter(c => c.state !== CircuitState.OPEN);

    if (!available.length) {
      this.logger.warn('cost 策略所有 Provider 均熔断 OPEN，无可用 Provider');
      if (detail) detail.outcome = 'all_open';
      return null;
    }

    // 解析有效 costPerUnit：缺失时回退到 provider_runtime_configs.cost_config
    const withCost = await Promise.all(
      available.map(async (c) => {
        let effectiveCost = c.costPerUnit;
        let costFromRuntime = false;

        // costPerUnit 缺失或非有效数字时，回退到 provider_runtime_configs
        if (effectiveCost == null || !Number.isFinite(effectiveCost)) {
          const runtimeConfig = await this.providerRuntimeConfigModel
            .findOne({ provider_name: c.provider })
            .lean()
            .exec();
          const fallbackCost = runtimeConfig?.cost_config?.cost_per_unit;
          effectiveCost = (fallbackCost != null && Number.isFinite(fallbackCost))
            ? fallbackCost
            : this.defaultHighCost;
          costFromRuntime = true;
        }

        // 计算有效延迟用于 tiebreaker
        const isUnknown = c.metrics.sampleCount < 10;
        const latencyMs = isUnknown ? this.defaultUnknownLatencyMs : c.metrics.avgLatencyMs;

        return { provider: c.provider, costPerUnit: effectiveCost, latencyMs, costFromRuntime };
      }),
    );

    if (detail) {
      detail.effectiveCosts = withCost.map((c) => ({
        provider: c.provider,
        costPerUnit: c.costPerUnit,
        latencyMs: c.latencyMs,
        costFromRuntimeConfig: c.costFromRuntime,
      }));
    }

    // 找到最低成本值
    const minCost = Math.min(...withCost.map(c => c.costPerUnit));

    // 筛选出成本等于最低值的候选者
    const lowestCostCandidates = withCost.filter(c => c.costPerUnit === minCost);

    let selectedProvider: string;
    if (lowestCostCandidates.length === 1) {
      selectedProvider = lowestCostCandidates[0].provider;
    } else {
      // 成本相同时用 avgLatencyMs 作为 tiebreaker（选延迟更低的）
      const minLatency = Math.min(...lowestCostCandidates.map(c => c.latencyMs));
      const lowestLatencyCandidates = lowestCostCandidates.filter(c => c.latencyMs === minLatency);

      if (lowestLatencyCandidates.length === 1) {
        selectedProvider = lowestLatencyCandidates[0].provider;
      } else {
        // 成本和延迟都相同时 round-robin（基于 seed hash）
        const idx = this.stableBucket(seed, lowestLatencyCandidates.length);
        if (detail) {
          detail.costTieBreakIndex = idx;
          detail.costTieBreakPool = lowestLatencyCandidates.map((c) => c.provider);
        }
        selectedProvider = lowestLatencyCandidates[idx].provider;
      }
    }

    const selected = withCost.find(c => c.provider === selectedProvider)!;

    if (detail) {
      detail.minCostPerUnit = minCost;
      detail.pickedProvider = selectedProvider;
    }

    // 构建 routingMetrics
    const routingMetrics: RoutingRuleHit['routingMetrics'] = {
      selectedCostPerUnit: selected.costPerUnit,
      candidates: withCost.map(c => ({
        provider: c.provider,
        costPerUnit: c.costPerUnit,
      })),
    };

    return { provider: selectedProvider, routingMetrics };
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
      case 'latency':
        return Array.isArray(r.latency_targets) && r.latency_targets.filter(t => t.trim()).length >= 2;
      case 'cost':
        return Array.isArray(r.cost_targets) && r.cost_targets.filter(t => t?.provider?.trim()).length >= 1;
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

  private clientMatches(r: LeanRule, apiKey: string): boolean {
    const rid = (r.apiKey ?? '').trim();
    if (rid === '') return true;
    return rid === apiKey;
  }

  private specificityScore(r: LeanRule, apiKey: string): number {
    const rid = (r.apiKey ?? '').trim();
    if (rid !== '' && rid === apiKey) return 1;
    return 0;
  }
}
