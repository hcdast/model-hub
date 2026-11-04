import { prepareModel } from './legacy-model-import';
import { BadRequestException } from '@nestjs/common';
import { pickModelConfig } from '../../common/utils/model-contract';
import { sanitizeParamDefinitions } from '../../common/utils/param-definitions-sanitize';

export const MAAS_CAPABILITIES: Record<string, string> = { 1501: 'imageToVideo', 1502: 'textToVideo', 1506: 'referenceToVideo', 1504: 'videoToVideo', 40002: 'imageToImage', 40001: 'textToImage' };
/** Documents are data. Never execute scripts or interpolate expressions from an import. */
export function mapModelImport(source: any, maasOnly = true) {
  const items = Array.isArray(source) ? source : source?.items;
  if (!Array.isArray(items) || items.length > 1000) throw new BadRequestException('JSON 应为模型数组或包含 items 数组，最多 1000 条');
  const result: Array<{ config: Record<string, any>; warnings: string[]; errors: string[] }> = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('每条模型必须为对象');
    const type = MAAS_CAPABILITIES[raw.model_type] || raw.model_type;
    if (maasOnly && (!['maas', 'akool-maas'].includes(raw.provider) || !Object.values(MAAS_CAPABILITIES).includes(type))) continue;
    if (typeof raw.model_type === 'number' && raw.provider === 'maas' && MAAS_CAPABILITIES[raw.model_type]) {
      try { const { doc, notes } = prepareModel(raw); result.push({ config: doc, warnings: notes, errors: [] }); }
      catch (error: any) { result.push({ config: { ...pickModelConfig(raw), model_type: type, provider: 'akool-maas', provider_model_name: raw.model_name }, warnings: [], errors: [error.message] }); }
      continue;
    }
    const config = pickModelConfig(raw);
    config.model_type = type;
    if (config.provider === 'maas') config.provider = 'akool-maas';
    config.provider_model_name ||= raw.params?.model?.default || raw.model_id;
    config.params = sanitizeParamDefinitions(Object.fromEntries(Object.entries(raw.params || {}).map(([name, value]: [string, any]) => {
      const def = { ...value };
      if (!def.enum?.length && Array.isArray(def.configs)) def.enum = def.configs.map((v: any) => v.value);
      if (def.default === undefined && Array.isArray(def.configs)) def.default = def.configs.find((v: any) => v.default)?.value;
      if (def.internal) def.hide = true;
      if (def.step !== undefined && ['number', 'integer'].includes(def.type)) def.multipleOf = def.step;
      return [name, def];
    })));
    const errors: string[] = [], warnings: string[] = [];
    if (Array.isArray(config.params_rules) && config.params_rules.some(r => !Array.isArray(r?.when))) {
      errors.push('旧版 params_rules 使用 effects/when 对象，需转换为当前条件规则后导入；未静默丢弃');
    }
    if (raw.icon) config.icon = raw.icon;
    if (typeof raw.model_type === 'number') warnings.push('已映射旧能力编号、厂商模型名称、内部参数及选项；请核对计费和媒体约束');
    result.push({ config, warnings, errors });
  }
  return { rows: result, excluded: items.length - result.length };
}

export function configDiff(before: Record<string, any>, after: Record<string, any>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map(field => ({ field, before: before[field], after: after[field] }));
}
