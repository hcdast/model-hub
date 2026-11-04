import type { ModelPricing, PublicModelPricing } from '../interfaces/model-contract.interface';
import { pickCreditReferenceUnitFromPriceMap } from '../../billing/unit-price-map.util';
import { matchesConditions } from './param-validator';

export function modelUsageType(modelType: string): 'count' | 'duration' | 'token' {
  if (['textToVideo', 'imageToVideo', 'videoToVideo', 'referenceToVideo', 'talkingPhoto'].includes(modelType)) return 'duration';
  return ['textGenerate', 'tts'].includes(modelType) ? 'token' : 'count';
}
export function resolveModelPriceTier(pricing: ModelPricing, input: Record<string, any>): string | undefined {
  const rule = pricing.tier_rules?.find(rule => matchesConditions(rule.when, input));
  return rule?.tier ?? (pricing.tier_param ? String(input[pricing.tier_param] ?? '') : undefined);
}
export function estimateModelPrice(config: { model_id: string; model_type: string; unit_price_map: Record<string, any>; pricing?: ModelPricing }, input: Record<string, any>) {
  const p = config.pricing || {};
  const usageType = p.usage_type || modelUsageType(config.model_type);
  const param = p.usage_param || (usageType === 'duration' ? 'duration' : usageType === 'token' ? 'max_tokens' : 'batch_quantity');
  const raw = input[param];
  const fallback = usageType === 'duration' ? 5 : usageType === 'token' ? 1000 : 1;
  const estimatedUsage = p.usage_measure === 'characters'
    ? (typeof raw === 'string' && raw.trim() ? Array.from(raw).length : 0)
    : raw === (p.auto_value ?? -1) ? (p.auto_prelock_units || 30) : raw ?? fallback;
  if (typeof estimatedUsage !== 'number' || !Number.isFinite(estimatedUsage) || estimatedUsage <= 0) throw new Error(`Invalid billing usage: ${param}`);
  const tier = resolveModelPriceTier(p, input);
  // Explicit conditional prices must never silently fall back to another tier.
  const explicitCredit = config.unit_price_map[tier || '']?.unit_credit;
  if (p.tier_rules?.some(rule => rule.tier === tier) && !(typeof explicitCredit === 'number' && Number.isFinite(explicitCredit) && explicitCredit > 0)) throw new Error(`Missing billing price tier: ${tier}`);
  const unitPrice = pickCreditReferenceUnitFromPriceMap(config.unit_price_map, tier);
  return { model: config.model_id, usageType, unitPrice, estimatedUsage, estimatedCost: unitPrice * estimatedUsage, currency: 'credit' };
}

/** Uses the same selection and usage calculation with public credit values only. */
export function estimatePublicModelPrice(modelType: string, pricing: PublicModelPricing, input: Record<string, any>) {
  if (pricing.currency !== 'credit') throw new Error('Unsupported pricing currency');
  return estimateModelPrice({ model_id: '', model_type: modelType, pricing,
    unit_price_map: Object.fromEntries(Object.entries(pricing.tiers).map(([tier, unit_credit]) => [tier, { unit_credit }])) }, input);
}
