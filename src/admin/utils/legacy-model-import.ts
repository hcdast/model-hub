import { legacyMediaConstraints, legacySizeRules } from '../../common/utils/media-constraints';
import { ModelConfigValidator } from './model-config-validator';
import { validateModelContract } from '../../common/utils/model-contract';
import { validateParams } from '../../common/utils/param-validator';
export const TYPES: Record<string, string> = { 1501: 'imageToVideo', 1502: 'textToVideo', 1504: 'videoToVideo', 1506: 'referenceToVideo', 40001: 'textToImage', 40002: 'imageToImage' };
const PARAM_KEYS = ['type', 'required', 'label', 'ui_type', 'default', 'description', 'enum', 'min', 'max', 'minLength', 'maxLength', 'minItems', 'maxItems', 'third_party_field', 'hide', 'enumDependsOn', 'extra_credit_multiplier', 'items', 'properties', 'additionalProperties', 'multipleOf', 'example', 'media', 'sizeRules'];
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const scalar = (value: any) => value && typeof value === 'object' && 'value' in value ? value.value : value;

function normalizeDefinition(name: string, raw: any, notes: string[]): any {
  const d: any = Object.fromEntries(PARAM_KEYS.filter(k => raw[k] !== undefined).map(k => [k, clone(raw[k])]));
  d.required = raw.required === true;
  if (d.default === undefined && Array.isArray(raw.configs)) d.default = raw.configs.find((c: any) => c.default === true)?.value;
  if (raw.enum) d.enum = raw.enum.map(scalar);
  else if (raw.configs?.length) d.enum = raw.configs.map((v: any) => v.value).filter((v: any) => v != null);
  // Same normalization as the existing collect-model-configs pipeline.
  if (name === 'generate_audio' && d.type !== 'boolean') {
    d.type = 'boolean';
    if (d.default !== undefined) d.default = d.default === true || d.default === 1 || d.default === 'true';
    delete d.enum;
    notes.push(`${name}: normalized legacy numeric audio toggle to boolean`);
  }
  if (raw.internal === true) d.hide = true;
  if (raw.step && ['number', 'integer'].includes(d.type)) d.multipleOf = raw.step;
  if (raw.format === 'uri') d.format = 'uri';
  if (d.type !== 'string') { delete d.minLength; delete d.maxLength; }
  if (!['integer', 'number'].includes(d.type)) { delete d.min; delete d.max; }
  if (d.type !== 'array') { delete d.minItems; delete d.maxItems; }
  if (d.enum?.includes(-1) && d.min > -1) { delete d.min; notes.push(`${name}: enum includes Auto (-1); removed conflicting min`); }
  if (d.items) d.items = normalizeDefinition(`${name}.items`, d.items, notes);
  else if (d.type === 'array' && raw.itemSchema) d.items = { type: 'object', required: true, properties: Object.fromEntries(Object.entries(raw.itemSchema).map(([k, v]) => [k, normalizeDefinition(k, v, notes)])) };
  else if (d.type === 'array') d.items = { type: raw.itemType || 'string', required: true };
  if (d.properties) d.properties = Object.fromEntries(Object.entries(d.properties).map(([k, v]) => [k, normalizeDefinition(k, v, notes)]));
  const media = legacyMediaConstraints(name, raw);
  if (media) {
    d.media = { ...media, ...d.media };
    if (d.type === 'string') d.format = 'uri';
    else if (d.items?.type === 'string') d.items.format = 'uri';
    d.ui_type = 'upload';
  }
  if (raw.sizeRules) d.sizeRules = legacySizeRules(raw.sizeRules);
  if (d.default !== undefined) {
    const errors = validateParams({ value: d.default }, { value: { ...d, required: false } }).errors;
    if (errors.length) {
      notes.push(`${name}: corrected invalid legacy default ${JSON.stringify(d.default)} (${errors.map(e => e.message).join('; ')})`);
      if (d.enum?.length === 1) d.default = d.enum[0];
      else delete d.default;
    }
  }
  return d;
}

function conditions(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw?.all) return raw.all.flatMap(conditions);
  if (!raw?.field) throw new Error('Unsupported rule condition');
  const operator = ({ not_empty: 'present', empty: 'absent' } as Record<string, string>)[raw.operator] || raw.operator;
  if (!['present', 'absent', 'eq', 'in'].includes(operator)) throw new Error(`Unsupported rule operator ${operator}`);
  return [{ field: raw.field, operator, ...(raw.value !== undefined ? { value: raw.value } : {}) }];
}

export function prepareModel(raw: any, existing?: any): { doc: any; notes: string[] } {
  const notes: string[] = [], limitations: string[] = [];
  const params: Record<string, any> = {};
  for (const [name, value] of Object.entries<any>(raw.params || {})) {
    if (!value?.type) { notes.push(`${name}: legacy UI metadata excluded from request parameters`); continue; }
    params[name] = normalizeDefinition(name, value, notes);
    const metadata = Object.fromEntries(Object.entries(value).filter(([k]) => !PARAM_KEYS.includes(k) && !['configs', 'internal', 'itemType', 'itemSchema', 'step'].includes(k)));
    if (Object.keys(metadata).length) limitations.push(`${name}: ${JSON.stringify(metadata)}`);
  }
  for (const field of raw.params?.extendFormSchema || []) {
    if (!params[field.name] && field.type === 'switch') params[field.name] = { type: 'boolean', required: false, default: field.default === true, label: field.label };
  }
  // provider_model_name identifies a unique config; params.model selects the shared upstream endpoint.
  const upstream = (params.model?.default || raw.model_name).replace(/^maas\//, '');
  params.model = { type: 'string', required: true, hide: true, default: upstream, enum: [upstream] };
  const rules: any[] = [];
  for (const rule of raw.params_rules || []) {
    if (rule.enabled === false) continue;
    const when = conditions(rule.when);
    // The old editor treated an unset optional boolean as false.
    for (const c of when) if (c.operator === 'eq' && c.value === false && params[c.field]?.type === 'boolean' && params[c.field].default === undefined) params[c.field].default = false;
    const next: any = { when, values: {} };
    for (const e of rule.effects || rule.restrict || []) {
      if (e.allowed_values) next.values[e.field] = e.allowed_values.map(scalar);
      else if (e.action === 'set_field_state' && e.state === 'disabled') { if (params[e.field]?.type === 'boolean') next.values[e.field] = [false]; else (next.forbid ||= []).push(e.field); }
      else throw new Error(`Unsupported rule effect ${e.action}`);
    }
    if (rule.message) next.message = rule.message;
    rules.push(next);
  }
  for (const d of Object.values<any>(params)) if (d.media?.kind === 'video' && Number.isFinite(raw.params?.duration?.maxInputOutputSeconds)) {
    d.media.maxInputOutputSeconds = raw.params.duration.maxInputOutputSeconds;
    d.media.outputDurationField = 'duration';
  }
  const media = raw.media_input_schema;
  const mediaFields = (media?.slots || []).flatMap((s: any) => [s.param, ...Object.values(s.paramMap || {})]).filter((p: any) => params[p]);
  if (media?.maxTotalItems && mediaFields.length) rules.push({ when: [], maxTotalItems: { fields: [...new Set(mediaFields)], max: media.maxTotalItems } });
  if (media?.minTotalItems && mediaFields.length) rules.push({ when: [], minTotalItems: { fields: [...new Set(mediaFields)], min: media.minTotalItems } });
  const pricing: any = { usage_type: raw.model_type < 40000 ? 'duration' : 'count' };
  if (pricing.usage_type === 'duration' && params.duration) pricing.usage_param = 'duration';
  else if (pricing.usage_type === 'count' && params.n) pricing.usage_param = 'n';
  const priceKeys = Object.keys(raw.unit_price_map || {});
  if (params.resolution && priceKeys.some(k => k.toLowerCase() === String(params.resolution.default).toLowerCase())) pricing.tier_param = 'resolution';
  const tierRules: any[] = [];
  for (const tier of priceKeys.filter(k => k !== 'default')) {
    const pieces = tier.split(':');
    if (pieces.length === 2 && params.resolution && params.quality?.enum?.includes(pieces[1])) tierRules.push({ when: [{ field: 'resolution', operator: 'eq', value: pieces[0] }, { field: 'quality', operator: 'eq', value: pieces[1] }], tier });
    else if (pieces.length === 2 && pieces[1] === 'video' && (params.videos || params.video)) tierRules.push({ when: [{ field: 'resolution', operator: 'eq', value: pieces[0] }, { field: params.videos ? 'videos' : 'video', operator: 'present' }], tier });
    else if (tier === 'vector_mode' && params.vector_mode) tierRules.push({ when: [{ field: 'vector_mode', operator: 'eq', value: true }], tier });
  }
  if (tierRules.length) pricing.tier_rules = tierRules;
  if (params.duration?.enum?.includes(-1)) {
    pricing.auto_value = -1;
    const b = raw.params.duration.billing;
    pricing.auto_prelock_units = b?.autoPrelockSeconds || b?.auto?.durationValue || raw.params.duration.maxInputOutputSeconds || 30;
  }
  const doc: any = { model_id: existing?.model_id || raw.model_id, model_type: TYPES[raw.model_type], provider: 'akool-maas',
    provider_model_name: raw.model_name, model_name: raw.label || raw.model_name, icon: raw.icon, description: raw.description || '', tags: raw.tags || [], sort: raw.sort || 0,
    disabled: raw.disabled === true, unit_price_map: clone(raw.unit_price_map), params, params_rules: rules, contract_version: 2, pricing,
    docs: { sections: [{ title: '导入来源', content: `AGI 模型配置导入；源模型：${raw.model_name}；MaaS 调用标识：${upstream}` },
      ...(raw.params?.ui?.assetsTips ? [{ title: '素材说明', content: raw.params.ui.assetsTips }] : []),
      ...(raw.icon ? [{ title: '模型图标', content: raw.icon }] : [])],
      ...(limitations.length ? { limitations: ['源参数元数据留档；媒体约束以 params.media 和 sizeRules 中的结构化规则为准：', ...limitations] } : {}) } };
  if (rules.length) notes.push('旧规则已转换为严格条件校验；不再自动替换用户输入的非法选项');
  if (limitations.length) notes.push('媒体格式、大小、尺寸、时长及自定义尺寸已转换为本地强制校验；其他源元数据保留供参考');
  const errors = [...ModelConfigValidator.validateConfig(doc).errors.map(e => e.message), ...validateModelContract(doc)];
  if (errors.length) throw new Error(`${raw.model_name}: ${errors.join('; ')}`);
  return { doc, notes };
}
