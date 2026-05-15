import type { ParamType } from '../interfaces/param-definition.interface';

/**
 * 写入前规范化 params：移除已废弃字段，并删除与 type 不匹配的约束键。
 */
export function sanitizeParamDefinitions(
  params: Record<string, any> | undefined | null,
): Record<string, any> | undefined {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) {
    return params as undefined;
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) {
      out[k] = v;
      continue;
    }
    const d = { ...v };
    delete d.configs;
    const t = d.type as ParamType | undefined;
    if (t !== 'string') {
      delete d.minLength;
      delete d.maxLength;
    }
    if (t !== 'number') {
      delete d.min;
      delete d.max;
    }
    if (t !== 'array') {
      delete d.minItems;
      delete d.maxItems;
    }
    out[k] = d;
  }
  return out;
}
