import {
  ALLOWED_PARAM_UI_TYPES,
  DefinitionValidationError,
  DefinitionValidationResult,
  ParamType,
} from '../interfaces/param-definition.interface';
import { sanitizeParamDefinitions } from './param-definitions-sanitize';
import { validateParams } from './param-validator';

/** 允许的参数类型列表 */
const ALLOWED_TYPES: ParamType[] = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

/**
 * 校验 params 字段中每个 ParamDefinition 的结构合法性。
 *
 * 先对原始对象做「约束与 type 是否匹配」校验，再经 sanitize 后做 enum / enumDependsOn 等校验。
 */
export function validateParamDefinitions(
  params: Record<string, any>, depth = 0,
): DefinitionValidationResult {
  const errors: DefinitionValidationError[] = [];
  if (!params || typeof params !== 'object' || Array.isArray(params) || depth > 12) return { valid: false, errors: [{ paramName: '', field: 'params', message: '参数定义必须为对象且不超过 12 层' }] };
  const raw = params ?? {};

  for (const [paramName, def] of Object.entries(raw)) {
    if (def == null || typeof def !== 'object' || Array.isArray(def)) {
      errors.push({
        paramName,
        field: 'definition',
        message: `参数 ${paramName} 的定义必须是对象`,
      });
      continue;
    }

    const t = def.type as ParamType | undefined;

    if (t !== 'string' && (def.minLength !== undefined || def.maxLength !== undefined)) {
      errors.push({
        paramName,
        field: 'minLength/maxLength',
        message: `参数 ${paramName} 仅在 type 为 string 时允许 minLength / maxLength`,
      });
    }
    if (t !== 'number' && t !== 'integer' && (def.min !== undefined || def.max !== undefined)) {
      errors.push({
        paramName,
        field: 'min/max',
        message: `参数 ${paramName} 仅在 type 为 number 时允许 min / max`,
      });
    }
    if (t !== 'array' && (def.minItems !== undefined || def.maxItems !== undefined)) {
      errors.push({
        paramName,
        field: 'minItems/maxItems',
        message: `参数 ${paramName} 仅在 type 为 array 时允许 minItems / maxItems`,
      });
    }
    if (t === 'string' && (def.min !== undefined || def.max !== undefined)) {
      errors.push({
        paramName,
        field: 'min/max',
        message: `参数 ${paramName} 为 string 时不应使用 min/max（应使用 minLength/maxLength）`,
      });
    }
    if (t === 'number' && (def.minLength !== undefined || def.maxLength !== undefined)) {
      errors.push({
        paramName,
        field: 'minLength/maxLength',
        message: `参数 ${paramName} 为 number 时不应使用 minLength/maxLength`,
      });
    }
  }

  const clean = sanitizeParamDefinitions(raw) ?? {};

  for (const [paramName, def] of Object.entries(clean)) {
    if (def == null || typeof def !== 'object' || Array.isArray(def)) {
      continue;
    }
    const fail = (field: string, message: string) => errors.push({ paramName, field, message });
    if (['__proto__', 'constructor', 'prototype'].includes(paramName)) fail('name', '参数名不能为保留字段');
    if (typeof def.required !== 'boolean') fail('required', 'required 必须为布尔值');
    if (def.enum !== undefined && (!Array.isArray(def.enum) || def.enum.some((v: unknown) => !['string', 'number', 'boolean'].includes(typeof v)))) fail('enum', 'enum 必须为标量数组');
    if (def.additionalProperties !== undefined && (def.type !== 'object' || typeof def.additionalProperties !== 'boolean')) fail('additionalProperties', 'additionalProperties 仅用于 object 且必须为布尔值');
    for (const key of ['min', 'max', 'minLength', 'maxLength', 'minItems', 'maxItems', 'multipleOf']) {
      if (def[key] !== undefined && (typeof def[key] !== 'number' || !Number.isFinite(def[key]))) fail(key, `${key} 必须为有限数字`);
    }
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) if (def[key] !== undefined && (!Number.isInteger(def[key]) || def[key] < 0)) fail(key, `${key} 必须为非负整数`);
    if (def.multipleOf !== undefined && (!['integer', 'number'].includes(def.type) || def.multipleOf <= 0)) fail('multipleOf', 'multipleOf 必须为正数且仅用于数值');
    if (def.format !== undefined && (def.type !== 'string' || def.format !== 'uri')) fail('format', '仅支持 string 的 uri 格式');
    if (def.items !== undefined) {
      if (def.type !== 'array') fail('items', 'items 仅用于 array');
      const result = validateParamDefinitions({ item: def.items }, depth + 1);
      errors.push(...result.errors.map(e => ({ ...e, paramName: `${paramName}.items.${e.paramName}` })));
    }
    if (def.properties !== undefined) {
      if (def.type !== 'object') fail('properties', 'properties 仅用于 object');
      const result = validateParamDefinitions(def.properties, depth + 1);
      errors.push(...result.errors.map(e => ({ ...e, paramName: `${paramName}.${e.paramName}` })));
    }
    if (def.media !== undefined) {
      const media = def.media;
      if (!media || !['string', 'array'].includes(def.type) || !['image', 'video', 'audio'].includes(media.kind)) fail('media', 'media 需要媒体种类以及 string/array 参数');
      if (media && def.type === 'array' && def.items && def.items.type !== 'string') fail('media', '媒体数组的 items 必须为 string URL');
      if (media?.maxBytes !== undefined && (!Number.isInteger(media.maxBytes) || media.maxBytes <= 0)) fail('media.maxBytes', 'maxBytes 必须为正整数');
      for (const key of ['width', 'height', 'resolution', 'aspectRatio', 'duration', 'totalDuration'] as const) {
        const range = media?.[key];
        if (range !== undefined && (!range || typeof range !== 'object' || Array.isArray(range) || Object.keys(range).some(k => !['min', 'max', 'exclusive'].includes(k)) || [range.min, range.max].some(v => v !== undefined && (!Number.isFinite(v) || v < 0)) || (range.min !== undefined && range.max !== undefined && range.min > range.max) || (range.exclusive !== undefined && typeof range.exclusive !== 'boolean'))) fail(`media.${key}`, '媒体范围必须为非负有限数且 min <= max');
      }
      if (media?.maxInputOutputSeconds !== undefined && (!Number.isFinite(media.maxInputOutputSeconds) || media.maxInputOutputSeconds <= 0)) fail('media.maxInputOutputSeconds', '总时长必须大于零');
      if (media?.outputDurationField !== undefined && (typeof media.outputDurationField !== 'string' || !media.outputDurationField.trim())) fail('media.outputDurationField', '必须为输出时长字段名');
      if (media?.accept !== undefined && (!Array.isArray(media.accept) || media.accept.some((v: unknown) => typeof v !== 'string' || !/^(image|video|audio)\/[\w.+*-]+$/.test(v)))) fail('media.accept', 'accept 必须为媒体 MIME 数组');
    }
    if (def.sizeRules !== undefined) {
      const r = def.sizeRules;
      const numeric = ['minSide', 'maxSide', 'minTotalPixels', 'maxTotalPixels', 'minAspectRatio', 'maxAspectRatio'];
      if (def.type !== 'string' || !r || typeof r !== 'object' || Array.isArray(r) || Object.entries(r).some(([k, v]) => k === 'sizeSeparator' ? !['x', '*'].includes(v as string) : !numeric.includes(k) || !Number.isFinite(v) || Number(v) <= 0)) fail('sizeRules', '尺寸规则无效');
      for (const [min, max] of [['minSide','maxSide'], ['minTotalPixels','maxTotalPixels'], ['minAspectRatio','maxAspectRatio']]) if ((r as any)?.[min] > (r as any)?.[max]) fail('sizeRules', '尺寸下限不能超过上限');
    }
    if (def.default !== undefined && ALLOWED_TYPES.includes(def.type)) {
      const result = validateParams({ value: def.default }, { value: { ...def, required: false, enumDependsOn: undefined, skipValidation: false } });
      if (!result.valid) fail('default', `默认值无效: ${result.errors.map(e => e.message).join('; ')}`);
    }

    if (!ALLOWED_TYPES.includes(def.type)) {
      errors.push({
        paramName,
        field: 'type',
        message: `参数 ${paramName} 的 type 必须是 [${ALLOWED_TYPES.join(', ')}] 之一，实际为 ${def.type}`,
      });
    }

    if (
      def.enum !== undefined &&
      Array.isArray(def.enum) &&
      def.default !== undefined &&
      !def.enum.includes(def.default)
    ) {
      errors.push({
        paramName,
        field: 'default',
        message: `参数 ${paramName} 的 default 值 ${def.default} 不在 enum [${def.enum.join(', ')}] 中`,
      });
    }

    if (def.min !== undefined && def.max !== undefined && def.min > def.max) {
      errors.push({
        paramName,
        field: 'min/max',
        message: `参数 ${paramName} 的 min (${def.min}) 不能大于 max (${def.max})`,
      });
    }

    if (
      def.minLength !== undefined &&
      def.maxLength !== undefined &&
      def.minLength > def.maxLength
    ) {
      errors.push({
        paramName,
        field: 'minLength/maxLength',
        message: `参数 ${paramName} 的 minLength (${def.minLength}) 不能大于 maxLength (${def.maxLength})`,
      });
    }

    if (
      def.minItems !== undefined &&
      def.maxItems !== undefined &&
      def.minItems > def.maxItems
    ) {
      errors.push({
        paramName,
        field: 'minItems/maxItems',
        message: `参数 ${paramName} 的 minItems (${def.minItems}) 不能大于 maxItems (${def.maxItems})`,
      });
    }

    if (def.ui_type !== undefined && def.ui_type !== null && def.ui_type !== '') {
      if (!ALLOWED_PARAM_UI_TYPES.includes(def.ui_type)) {
        errors.push({
          paramName,
          field: 'ui_type',
          message: `参数 ${paramName} 的 ui_type 必须是 [${ALLOWED_PARAM_UI_TYPES.join(', ')}] 之一，实际为 ${def.ui_type}`,
        });
      }
    }

    if (def.enumDependsOn !== undefined && def.enumDependsOn !== null) {
      const ed = def.enumDependsOn;
      if (typeof ed !== 'object' || Array.isArray(ed)) {
        errors.push({
          paramName,
          field: 'enumDependsOn',
          message: `参数 ${paramName} 的 enumDependsOn 必须是对象`,
        });
      } else {
        if (!ed.param || typeof ed.param !== 'string' || ed.param.trim() === '') {
          errors.push({
            paramName,
            field: 'enumDependsOn.param',
            message: `参数 ${paramName} 的 enumDependsOn.param 不能为空`,
          });
        } else if (ed.param === paramName) {
          errors.push({
            paramName,
            field: 'enumDependsOn.param',
            message: `参数 ${paramName} 的 enumDependsOn 不能依赖自身`,
          });
        } else if (!Object.prototype.hasOwnProperty.call(clean, ed.param)) {
          errors.push({
            paramName,
            field: 'enumDependsOn.param',
            message: `参数 ${paramName} 的 enumDependsOn 引用了不存在的字段 ${ed.param}`,
          });
        }
        if (!ed.map || typeof ed.map !== 'object' || Array.isArray(ed.map)) {
          errors.push({
            paramName,
            field: 'enumDependsOn.map',
            message: `参数 ${paramName} 的 enumDependsOn.map 必须为对象`,
          });
        } else {
          const allowed = Array.isArray(def.enum) && def.enum.length > 0 ? new Set(def.enum.map((v: unknown) => JSON.stringify(v))) : undefined;
          for (const [k, arr] of Object.entries(ed.map)) {
            if (!Array.isArray(arr)) {
              errors.push({
                paramName,
                field: 'enumDependsOn.map',
                message: `参数 ${paramName} 的 enumDependsOn.map[${k}] 必须为数组`,
              });
              continue;
            }
            for (const item of arr) {
              if (!['string', 'number', 'boolean'].includes(typeof item) || (allowed && !allowed.has(JSON.stringify(item)))) {
                errors.push({
                  paramName,
                  field: 'enumDependsOn.map',
                  message: `参数 ${paramName} 的 enumDependsOn.map[${k}] 含不在 enum 中的值 ${JSON.stringify(item)}`,
                });
              }
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
