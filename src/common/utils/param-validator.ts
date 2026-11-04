import { imageSizeError } from './media-constraints';
import type { ParamDefinition, ParamDefinitions, ParamValidationError, ParamValidationResult } from '../interfaces/param-definition.interface';
import type { ParamRule, RuleCondition } from '../interfaces/model-contract.interface';
import { resolveEnumValues } from './param-enum.util';

export const hasValue = (v: any): boolean => v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length > 0);
export function matchesConditions(conditions: RuleCondition[], values: Record<string, any>): boolean {
  return conditions.every(c => c.operator === 'present' ? hasValue(values[c.field]) : c.operator === 'absent' ? !hasValue(values[c.field])
    : c.operator === 'in' ? Array.isArray(c.value) && c.value.includes(values[c.field]) : values[c.field] === c.value);
}
export function validateRules(input: Record<string, any>, rules: ParamRule[] = []): ParamValidationError[] {
  const errors: ParamValidationError[] = [];
  for (const rule of rules) {
    if (!matchesConditions(rule.when, input)) continue;
    const fail = (field: string, message: string) => errors.push({ field, message: rule.message || message });
    for (const field of rule.require || []) if (!hasValue(input[field])) fail(field, `${field} 在当前条件下必填`);
    for (const field of rule.forbid || []) if (hasValue(input[field])) fail(field, `${field} 在当前条件下不可设置`);
    for (const [field, allowed] of Object.entries(rule.values || {})) if (!allowed.includes(input[field])) fail(field, `${field} 在当前条件下必须为 ${allowed.join(', ')}`);
    if (rule.minTotalItems) {
      const count = rule.minTotalItems.fields.reduce((n, f) => n + (Array.isArray(input[f]) ? input[f].length : hasValue(input[f]) ? 1 : 0), 0);
      if (count < rule.minTotalItems.min) fail(rule.minTotalItems.fields.join(','), `素材总数量不能少于 ${rule.minTotalItems.min}`);
    }
    if (rule.maxTotalItems) {
      const count = rule.maxTotalItems.fields.reduce((n, f) => n + (Array.isArray(input[f]) ? input[f].length : hasValue(input[f]) ? 1 : 0), 0);
      if (count > rule.maxTotalItems.max) fail(rule.maxTotalItems.fields.join(','), `素材总数量不能超过 ${rule.maxTotalItems.max}`);
    }
  }
  return errors;
}

/** Shared by server and portal; defaults resolve before dependent enums and rules. */
export function validateParams(input: Record<string, any>, definitions: ParamDefinitions, rules: ParamRule[] = [], depth = 0): ParamValidationResult {
  const errors: ParamValidationError[] = [];
  const sanitized: Record<string, any> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || depth > 12) return { valid: false, errors: [{ field: '', message: '参数必须为对象且嵌套不能超过 12 层' }], sanitized };
  const effective = { ...input };
  for (const [field, def] of Object.entries(definitions)) if (def && effective[field] == null && def.default !== undefined) effective[field] = def.default;
  for (const [field, def] of Object.entries(definitions)) {
    if (!def || !def.type) continue;
    let value = effective[field];
    if (value === undefined || value === null) { if (def.required && !def.skipValidation) errors.push({ field, message: `${field} 是必填参数` }); continue; }
    if (def.skipValidation) { sanitized[field] = value; continue; }
    const fail = (message: string) => errors.push({ field, message });
    if (!checkType(value, def.type)) { fail(`${field} 期望类型 ${def.type}`); continue; }
    if (def.required && !hasValue(value)) fail(`${field} 是必填参数`);
    const enums = resolveEnumValues(def.enum);
    if (enums.length && !enums.includes(value)) fail(`${field} 不在可选值中`);
    if (def.enumDependsOn) {
      const allowed = def.enumDependsOn.map[String(effective[def.enumDependsOn.param] ?? '')];
      if (!allowed || !allowed.includes(value)) fail(`${field} 不符合 ${def.enumDependsOn.param} 的联动限制`);
    }
    if (typeof value === 'number') {
      if (def.min !== undefined && value < def.min) fail(`${field} 不能小于 ${def.min}`);
      if (def.max !== undefined && value > def.max) fail(`${field} 不能大于 ${def.max}`);
      if (def.multipleOf && Math.abs(value / def.multipleOf - Math.round(value / def.multipleOf)) > 1e-8) fail(`${field} 必须为 ${def.multipleOf} 的倍数`);
    }
    if (typeof value === 'string') {
      if (def.sizeRules) { const message = imageSizeError(value, def.sizeRules); if (message) fail(`${field}: ${message}`); }
      if (def.minLength !== undefined && value.length < def.minLength) fail(`${field} 长度不能小于 ${def.minLength}`);
      if (def.maxLength !== undefined && value.length > def.maxLength) fail(`${field} 长度不能大于 ${def.maxLength}`);
      if (def.format === 'uri' || def.media) {
        try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
        catch { fail(`${field} 必须是 HTTP(S) URL`); }
      }
    }
    if (Array.isArray(value)) {
      if (def.minItems !== undefined && value.length < def.minItems) fail(`${field} 至少需要 ${def.minItems} 项`);
      if (def.maxItems !== undefined && value.length > def.maxItems) fail(`${field} 最多允许 ${def.maxItems} 项`);
      if (def.items || def.media) value = value.map((item, i) => {
        const itemDef: ParamDefinition = def.items ? { ...def.items, ...(def.media ? { format: 'uri' as const } : {}) } : { type: 'string', required: true, format: 'uri' };
        const result = validateParams({ item }, { item: itemDef }, [], depth + 1);
        errors.push(...result.errors.map(e => ({ ...e, field: `${field}[${i}]${e.field === 'item' ? '' : '.' + e.field.slice(5)}` })));
        return result.sanitized.item;
      });
    }
    if (def.type === 'object' && def.properties) {
      const result = validateParams(value, def.properties, [], depth + 1);
      errors.push(...result.errors.map(e => ({ ...e, field: `${field}.${e.field}` })));
      value = def.additionalProperties === true ? { ...value, ...result.sanitized } : result.sanitized;
    }
    Object.defineProperty(sanitized, field, { value, enumerable: true, writable: true, configurable: true });
  }
  errors.push(...validateRules(sanitized, rules));
  return { valid: !errors.length, errors, sanitized };
}
function checkType(value: any, type: string): boolean {
  return type === 'array' ? Array.isArray(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : ['string', 'boolean'].includes(type) && typeof value === type;
}
