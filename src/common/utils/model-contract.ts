import type { ModelContract, RuleCondition } from '../interfaces/model-contract.interface';
import type { ParamDefinition, ParamDefinitions } from '../interfaces/param-definition.interface';
import { validateParamDefinitions } from './param-definition-validator';
import { validateParams } from './param-validator';

export const MODEL_CONFIG_FIELDS = ['icon', 'model_id', 'model_type', 'provider', 'provider_model_name', 'model_name', 'description', 'tags', 'sort', 'disabled', 'unit_price_map', 'params', 'contract_version', 'params_rules', 'ui_schema', 'output_schema', 'docs', 'examples', 'pricing'] as const;
export function pickModelConfig(value: Record<string, any>): Record<string, any> {
  return Object.fromEntries(MODEL_CONFIG_FIELDS.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
}
export function validateModelContract(config: ModelContract & { unit_price_map?: Record<string, any> }): string[] {
  const errors: string[] = [];
  for (const field of ['params', 'ui_schema', 'output_schema', 'docs', 'pricing'] as const) {
    const value = config[field];
    if (value != null && (typeof value !== 'object' || Array.isArray(value))) errors.push(`${field} 必须为对象`);
  }
  if (errors.length) return errors;
  const params = config.params || {};
  const exists = (name: unknown) => typeof name === 'string' && Object.hasOwnProperty.call(params, name);
  const validConditions = (value: unknown): value is RuleCondition[] => Array.isArray(value) && value.every(c => c && exists(c.field) && ['eq', 'in', 'present', 'absent'].includes(c.operator) && (c.operator !== 'in' || Array.isArray(c.value)));
  if (config.params) errors.push(...validateParamDefinitions(config.params).errors.map(e => `${e.paramName}.${e.field}: ${e.message}`));
  if (config.output_schema) errors.push(...validateParamDefinitions({ result: config.output_schema }).errors.map(e => `output_schema.${e.paramName}: ${e.message}`));
  if (config.params_rules !== undefined) {
    if (!Array.isArray(config.params_rules)) errors.push('params_rules 必须为数组');
    else for (const r of config.params_rules) {
      if (!r || !validConditions(r.when)) { errors.push('规则条件无效或引用不存在的参数'); continue; }
      for (const k of ['require', 'forbid'] as const) if (r[k] !== undefined && (!Array.isArray(r[k]) || r[k]!.some(f => !exists(f)))) errors.push(`规则 ${k} 必须引用现有参数`);
      if (r.values && (typeof r.values !== 'object' || Array.isArray(r.values) || Object.entries(r.values).some(([f, v]) => !exists(f) || !Array.isArray(v)))) errors.push('规则 values 无效');
      if (r.minTotalItems && (!Array.isArray(r.minTotalItems.fields) || r.minTotalItems.fields.some(f => !exists(f)) || !Number.isInteger(r.minTotalItems.min) || r.minTotalItems.min < 0)) errors.push('minTotalItems 无效');
      if (r.maxTotalItems && (!Array.isArray(r.maxTotalItems.fields) || r.maxTotalItems.fields.some(f => !exists(f)) || !Number.isInteger(r.maxTotalItems.max) || r.maxTotalItems.max < 0)) errors.push('maxTotalItems 无效');
      if (r.message !== undefined && typeof r.message !== 'string') errors.push('规则 message 必须为文本');
    }
  }
  if (config.ui_schema) {
    if (config.ui_schema.groups !== undefined && (!config.ui_schema.groups || typeof config.ui_schema.groups !== 'object' || Array.isArray(config.ui_schema.groups))) errors.push('ui_schema.groups 必须为字段分组对象');
    for (const names of [config.ui_schema.order, config.ui_schema.advanced, ...Object.values(config.ui_schema.groups || {})]) if (names !== undefined && (!Array.isArray(names) || names.some(f => !exists(f)))) errors.push('ui_schema 必须引用现有参数');
    const grouped = Object.values(config.ui_schema.groups || {}).filter(Array.isArray).flat();
    if (new Set(grouped).size !== grouped.length) errors.push('参数只能出现在一个展示分组中');
  }
  if (config.docs && ((config.docs.sections !== undefined && (!Array.isArray(config.docs.sections) || config.docs.sections.some(s => !s || typeof s.title !== 'string' || typeof s.content !== 'string'))) || (config.docs.limitations !== undefined && (!Array.isArray(config.docs.limitations) || config.docs.limitations.some(s => typeof s !== 'string'))))) errors.push('docs 章节和限制必须为文本');
  if (config.pricing) {
    const p = config.pricing;
    if (p.usage_type && !['count', 'duration', 'token'].includes(p.usage_type)) errors.push('pricing.usage_type 无效');
    if (p.usage_measure !== undefined && (p.usage_measure !== 'characters' || p.usage_type !== 'count' || !p.usage_param || config.params?.[p.usage_param]?.type !== 'string')) errors.push('按字符计费必须使用 count，且 usage_param 指向文本参数');
    for (const k of ['usage_param', 'tier_param'] as const) if (p[k] && !exists(p[k])) errors.push(`pricing.${k} 引用不存在的参数`);
    if (p.auto_value !== undefined && !Number.isFinite(p.auto_value)) errors.push('pricing.auto_value 必须为有限数字');
    if (p.auto_prelock_units !== undefined && (!Number.isFinite(p.auto_prelock_units) || p.auto_prelock_units <= 0)) errors.push('pricing.auto_prelock_units 必须大于零');
    if (p.tier_rules !== undefined) {
      if (!Array.isArray(p.tier_rules)) errors.push('pricing.tier_rules 必须为数组');
      else for (const rule of p.tier_rules) {
        if (!rule || !validConditions(rule.when) || typeof rule.tier !== 'string' || !rule.tier.trim()) { errors.push('pricing.tier_rules 条件或档位无效'); continue; }
        if (config.unit_price_map !== undefined && !(typeof config.unit_price_map?.[rule.tier]?.unit_credit === 'number' && Number.isFinite(config.unit_price_map[rule.tier].unit_credit) && config.unit_price_map[rule.tier].unit_credit > 0)) errors.push(`pricing.tier_rules 缺少有效价格档位 ${rule.tier}`);
      }
    }
  }
  if (config.examples !== undefined) {
    if (!Array.isArray(config.examples)) errors.push('examples 必须为数组');
    else if (!errors.length) for (const example of config.examples) {
      if (!example || typeof example.name !== 'string' || !example.input || typeof example.input !== 'object' || Array.isArray(example.input)) { errors.push('示例必须含 name 和 input'); continue; }
      const result = validateParams(example.input, params, config.params_rules);
      errors.push(...result.errors.map(e => `示例 ${example.name}: ${e.message}`));
      if (config.output_schema && example.output !== undefined) {
        const output = validateParams({ result: example.output }, { result: config.output_schema });
        errors.push(...output.errors.map(e => `示例 ${example.name} 输出: ${e.message}`));
      }
    }
  }
  return errors;
}

/** Explicit public projection; provider mapping, skipValidation and hidden nested defaults stay private. */
export function publicDefinition(def: ParamDefinition): ParamDefinition {
  const keys = ['type', 'required', 'label', 'ui_type', 'description', 'enum', 'min', 'max', 'minLength', 'maxLength', 'minItems', 'maxItems', 'multipleOf', 'format', 'additionalProperties', 'media', 'sizeRules'] as const;
  const out: any = Object.fromEntries(keys.filter(k => def[k] !== undefined).map(k => [k, def[k]]));
  if (def.media) out.media = Object.fromEntries(['kind', 'accept', 'maxBytes', 'referencePrefix', 'width', 'height', 'resolution', 'aspectRatio', 'duration', 'totalDuration', 'maxInputOutputSeconds', 'outputDurationField'].filter(k => (def.media as any)[k] !== undefined).map(k => [k, (def.media as any)[k]]));
  if (def.properties) out.properties = publicDefinitions(def.properties);
  if (def.items) out.items = publicDefinition(def.items);
  for (const k of ['default', 'example'] as const) if (def[k] !== undefined) out[k] = publicValue(def[k], out);
  return out;
}
export function publicDefinitions(params: ParamDefinitions): ParamDefinitions {
  const result: ParamDefinitions = Object.fromEntries(Object.entries(params).filter(([, d]) => d && !d.hide && ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(d.type)).map(([k, d]) => [k, publicDefinition(d)]));
  for (const [k, d] of Object.entries(params)) if (result[k] && d.enumDependsOn && result[d.enumDependsOn.param]) result[k].enumDependsOn = d.enumDependsOn;
  return result;
}
export function publicValue(value: any, definition: ParamDefinition): any {
  if (definition.type === 'array' && Array.isArray(value) && definition.items) return value.map(v => publicValue(v, definition.items!));
  if (definition.type === 'object' && definition.properties && value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.entries(definition.properties).filter(([k]) => Object.hasOwnProperty.call(value, k)).map(([k, d]) => [k, publicValue(value[k], d)]));
  return value;
}
