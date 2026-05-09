import { UsageType } from './interfaces/billing.interface';

export interface ActualUsageExtractionOptions {
  durationStep: number;
  /** 任务请求 input，与 PricingService.estimate 一致，在供应商未返回用量时回退 */
  requestInput?: Record<string, any>;
}

function parsePositiveNumber(v: unknown): number | undefined {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  return undefined;
}

/**
 * 从供应商 result 中解析视频时长（秒）。
 * 常见情况：轮询结果为单个 URL 字符串，无 duration 字段，需回退到请求参数。
 */
export function extractDurationSecondsFromResult(result: unknown): number | undefined {
  if (result == null) return undefined;
  if (typeof result === 'number') return parsePositiveNumber(result);
  if (typeof result === 'string') return undefined;

  if (Array.isArray(result)) {
    for (const item of result) {
      const d = extractDurationSecondsFromResult(item);
      if (d != null) return d;
    }
    return undefined;
  }

  if (typeof result === 'object') {
    const o = result as Record<string, any>;
    const candidates = [
      o.duration,
      o.video_duration,
      o.videoDuration,
      o.length_seconds,
      o.lengthSeconds,
      o.metadata?.duration,
      o.meta?.duration,
      o.output?.duration,
      Array.isArray(o.outputs) ? o.outputs[0]?.duration : undefined,
    ];
    for (const c of candidates) {
      const p = parsePositiveNumber(c);
      if (p != null) return p;
    }
  }
  return undefined;
}

/**
 * 计算任务结算时的实际用量，与 PricingService 中用量类型语义一致。
 */
export function computeActualUsageValue(
  usageType: UsageType,
  result: unknown,
  options: ActualUsageExtractionOptions,
): number {
  const input = options.requestInput;

  switch (usageType) {
    case UsageType.TOKEN: {
      const r = result as Record<string, any> | undefined;
      const usage = r?.usage;
      if (usage?.total_tokens && typeof usage.total_tokens === 'number') {
        return usage.total_tokens;
      }
      if (usage?.input_tokens || usage?.output_tokens) {
        return (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
      }
      if (usage?.prompt_tokens || usage?.completion_tokens) {
        return (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);
      }
      return 1;
    }
    case UsageType.COUNT: {
      const r = result as Record<string, any> | undefined;
      const fromResult =
        parsePositiveNumber(r?.batch_quantity) ?? parsePositiveNumber(r?.image_count);
      if (fromResult != null) return fromResult;
      const fromInput = parsePositiveNumber(input?.batch_quantity);
      if (fromInput != null) return fromInput;
      return 1;
    }
    case UsageType.DURATION: {
      const fromResult = extractDurationSecondsFromResult(result);
      if (fromResult != null) return fromResult;
      const fromInput = parsePositiveNumber(input?.duration);
      if (fromInput != null) return fromInput;
      const step = parsePositiveNumber(options.durationStep);
      return step ?? 1;
    }
    default:
      return 1;
  }
}
