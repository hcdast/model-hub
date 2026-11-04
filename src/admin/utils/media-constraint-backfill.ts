import { validateModelContract } from '../../common/utils/model-contract';

/** Add missing executable constraints without replacing prices, identity, status or custom rules. */
export function mediaConstraintBackfill(existing: any, prepared: any): Record<string, any> {
  const set: Record<string, any> = {};
  const candidate = JSON.parse(JSON.stringify(existing));
  for (const [field, source] of Object.entries<any>(prepared.params || {})) {
    const target = candidate.params?.[field];
    if (!target || target.type !== source.type) continue;
    if (source.media) {
      const media = { ...source.media, ...target.media };
      if (target.media?.accept?.every((v: string) => v.endsWith('/*'))) media.accept = source.media.accept;
      if (JSON.stringify(media) !== JSON.stringify(target.media)) { target.media = media; set[`params.${field}.media`] = media; }
    }
    if (source.sizeRules && !target.sizeRules) { target.sizeRules = source.sizeRules; set[`params.${field}.sizeRules`] = source.sizeRules; }
  }
  const rules = [...(candidate.params_rules || [])];
  for (const rule of prepared.params_rules || []) if ((rule.minTotalItems || rule.maxTotalItems) && !rules.some(r => JSON.stringify(r) === JSON.stringify(rule))) rules.push(rule);
  if (JSON.stringify(rules) !== JSON.stringify(candidate.params_rules || [])) set.params_rules = candidate.params_rules = rules;
  const errors = validateModelContract(candidate);
  if (errors.length) throw new Error(`${existing.model_id}: ${errors.join('; ')}`);
  return set;
}
