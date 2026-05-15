import { BASIC_FIELD_NAMES } from './constants';

/** 从完整配置中取出基础信息字段（不含 params / unit_price_map） */
export function pickBasic(v: Record<string, any>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of BASIC_FIELD_NAMES) {
    if (v[k] !== undefined) o[k] = v[k];
  }
  return o;
}
