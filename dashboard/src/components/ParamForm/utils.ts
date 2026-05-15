/**
 * 参数表单工具函数
 */

import { ALLOWED_PARAM_UI_TYPES } from '@model-hub/common/interfaces/param-definition.interface';
import type { ParamDefinition, ParamDefinitions, ParamUIType } from './types';

/** 敏感字段名模式 */
const SENSITIVE_FIELD_PATTERNS = [
  /secret/i,
  /password/i,
  /token/i,
  /api_key/i,
  /apikey/i,
  /jwt/i,
  /credential/i,
];

/** 长文本字段名模式 */
const LONG_TEXT_PATTERNS = [
  /^prompt$/i,
  /^negative_prompt$/i,
  /^description$/i,
  /^content$/i,
  /^text$/i,
  /^message$/i,
  /^instructions$/i,
];

/**
 * 推断参数的 UI 控件类型
 * @param name 参数名称
 * @param def 参数定义
 * @returns UI 控件类型
 */
export function inferUIType(name: string, def: ParamDefinition): ParamUIType {
  const explicit = def.ui_type;
  if (
    explicit &&
    (ALLOWED_PARAM_UI_TYPES as readonly string[]).includes(explicit)
  ) {
    return explicit;
  }

  // 有 enum 的情况
  if (def.enum && def.enum.length > 0) {
    // boolean enum（如 [true, false]）
    if (def.type === 'boolean') {
      return 'radio';
    }
    // 小枚举使用 radio
    if (def.enum.length <= 3) {
      return 'radio';
    }
    // 其他使用 select
    return 'select';
  }

  // boolean 类型
  if (def.type === 'boolean') {
    return 'switch';
  }

  // number 类型
  if (def.type === 'number') {
    // 如果有 min/max 且范围较小，使用 slider
    if (def.min !== undefined && def.max !== undefined) {
      const range = def.max - def.min;
      const isIntegerRange = Number.isInteger(def.min) && Number.isInteger(def.max);
      if (isIntegerRange && range <= 20 && range > 0) {
        return 'slider';
      }
    }
    return 'input-number';
  }

  // array 类型
  if (def.type === 'array') {
    return 'tags';
  }

  // string 类型
  if (def.type === 'string') {
    // 检查是否为敏感字段
    if (SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(name))) {
      return 'password';
    }

    // 检查是否为长文本
    if (
      LONG_TEXT_PATTERNS.some(pattern => pattern.test(name)) ||
      (def.maxLength !== undefined && def.maxLength > 500) ||
      (def.description && def.description.length > 100)
    ) {
      return 'textarea';
    }

    return 'input';
  }

  // 默认使用 input
  return 'input';
}

/**
 * 判断是否为复杂数组（元素为对象类型，使用 JSON 文本编辑）
 */
export function isComplexArray(def: ParamDefinition): boolean {
  if (def.type !== 'array') {
    return false;
  }

  const complexArrayPatterns = [
    /element_list/i,
    /mappings/i,
    /items/i,
    /objects/i,
  ];

  return complexArrayPatterns.some(pattern => pattern.test(def.description || ''));
}

/** tags 模式为数组长度；复杂数组为 JSON 解析后的数组长度；空为 0 */
function countArrayElements(value: unknown, def: ParamDefinition): number | null {
  if (def.type !== 'array') return null;
  if (Array.isArray(value)) return value.length;
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return 0;
  }
  if (typeof value === 'string' && isComplexArray(def)) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.length : null;
    } catch {
      return null;
    }
  }
  return 0;
}

/**
 * 构建表单验证规则
 * @param name 参数名称
 * @param def 参数定义
 * @param skipValidation 是否跳过验证
 * @returns Ant Design Form rules
 */
export function buildFormRules(
  name: string,
  def: ParamDefinition,
  skipValidation?: boolean
): any[] {
  // 如果设置了 skipValidation，跳过所有验证
  if (skipValidation || def.skipValidation) {
    return [];
  }

  const rules: any[] = [];

  // 必填验证
  if (def.required) {
    rules.push({
      required: true,
      message: `${name} 是必填参数`,
    });
  }

  // 字符串长度验证
  if (def.type === 'string') {
    if (def.minLength !== undefined) {
      rules.push({
        min: def.minLength,
        message: `最小长度为 ${def.minLength} 个字符`,
      });
    }
    if (def.maxLength !== undefined) {
      rules.push({
        max: def.maxLength,
        message: `最大长度为 ${def.maxLength} 个字符`,
      });
    }
  }

  // 数值范围验证
  if (def.type === 'number') {
    if (def.min !== undefined && def.max !== undefined) {
      rules.push({
        type: 'number',
        min: def.min,
        max: def.max,
        message: `值必须在 ${def.min} 到 ${def.max} 之间`,
      });
    } else if (def.min !== undefined) {
      rules.push({
        type: 'number',
        min: def.min,
        message: `值不能小于 ${def.min}`,
      });
    } else if (def.max !== undefined) {
      rules.push({
        type: 'number',
        max: def.max,
        message: `值不能大于 ${def.max}`,
      });
    }
  }

  // 数组元素个数（minItems / maxItems），与 params 定义一致
  if (
    def.type === 'array' &&
    (def.minItems !== undefined || def.maxItems !== undefined)
  ) {
    rules.push({
      validator: async (_: unknown, value: unknown) => {
        const n = countArrayElements(value, def);
        if (n === null) {
          throw new Error(`${name} 须为合法 JSON 数组`);
        }
        if (def.minItems !== undefined && n < def.minItems) {
          throw new Error(`${name} 至少需要 ${def.minItems} 个元素`);
        }
        if (def.maxItems !== undefined && n > def.maxItems) {
          throw new Error(`${name} 最多允许 ${def.maxItems} 个元素`);
        }
      },
    });
  }

  return rules;
}

/**
 * 从参数定义生成默认表单值
 * @param definitions 参数定义集合
 * @returns 默认表单值
 */
export function getInitialValues(definitions: ParamDefinitions): Record<string, any> {
  const values: Record<string, any> = {};

  for (const [key, def] of Object.entries(definitions)) {
    // 跳过隐藏参数
    if (def.hide) {
      continue;
    }

    // 使用默认值
    if (def.default !== undefined) {
      values[key] = def.default;
    } else if (def.type === 'boolean') {
      values[key] = false;
    } else if (def.type === 'array') {
      values[key] = [];
    } else if (def.type === 'number') {
      values[key] = def.min ?? 0;
    }
  }

  return values;
}

/**
 * 从参数定义生成 Select/Radio 选项（枚举值即展示文案）
 */
export function getSelectOptions(
  def: ParamDefinition
): { label: string; value: string | number | boolean }[] {
  if (!def.enum || def.enum.length === 0) {
    return [];
  }

  return def.enum.map(v => ({
    label: String(v),
    value: v,
  }));
}

/**
 * 按 enumDependsOn 过滤下拉/单选选项（依赖字段变化时联动）
 */
export function getFilteredSelectOptions(
  def: ParamDefinition,
  dependencyFieldValue: unknown,
): { label: string; value: string | number | boolean }[] {
  const base = getSelectOptions(def);
  const dep = def.enumDependsOn;
  if (
    !dep?.map ||
    dependencyFieldValue === undefined ||
    dependencyFieldValue === null
  ) {
    return base;
  }
  const key = String(dependencyFieldValue);
  const allowed = dep.map[key];
  if (!Array.isArray(allowed) || allowed.length === 0) {
    return base;
  }
  const allowSet = new Set(allowed.map(v => JSON.stringify(v)));
  return base.filter(o => allowSet.has(JSON.stringify(o.value)));
}

/**
 * 根据 aspect_ratio 等依赖字段解析 resolution 等参数的可用选项（内部使用 enumDependsOn）
 */
export function getAvailableResolutions(
  resolutionDef: ParamDefinition,
  aspectRatioValue: string | undefined,
  _aspectRatioDef: ParamDefinition,
): { label: string; value: string | number | boolean }[] {
  return getFilteredSelectOptions(resolutionDef, aspectRatioValue);
}

/**
 * 过滤隐藏参数
 * @param definitions 参数定义集合
 * @returns 过滤后的参数定义集合
 */
export function filterHiddenParams(definitions: ParamDefinitions): ParamDefinitions {
  const result: ParamDefinitions = {};

  for (const [key, def] of Object.entries(definitions)) {
    if (!def.hide) {
      result[key] = def;
    }
  }

  return result;
}

/**
 * 将参数分组为必填和可选
 * @param definitions 参数定义集合
 * @returns 分组后的参数列表 [必填参数, 可选参数]
 */
export function groupParams(
  definitions: ParamDefinitions
): [string[], string[]] {
  const required: string[] = [];
  const optional: string[] = [];

  for (const [key, def] of Object.entries(definitions)) {
    if (def.hide) {
      continue;
    }

    if (def.required) {
      required.push(key);
    } else {
      optional.push(key);
    }
  }

  return [required, optional];
}

/**
 * 格式化参数名称为显示标签
 * @param name 参数名称
 * @returns 格式化后的标签
 */
export function formatParamLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}
