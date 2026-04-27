import {
  ParamDefinitions,
  TransformResult,
} from '../interfaces/param-definition.interface';

/**
 * 正向转换：将统一参数名转换为第三方厂商字段名。
 *
 * - 有 third_party_field 的参数：key 替换为 third_party_field
 * - 没有 third_party_field 的参数：保持原始 key
 * - 仅输出 definitions 中定义的参数
 */
export function transformParams(
  params: Record<string, any>,
  definitions: ParamDefinitions,
): TransformResult {
  const transformed: Record<string, any> = {};
  const fieldMapping: Record<string, string> = {};

  for (const [key, def] of Object.entries(definitions)) {
    if (!(key in params)) continue;

    const targetKey = def.third_party_field ?? key;
    transformed[targetKey] = params[key];
    fieldMapping[key] = targetKey;
  }

  return { transformed, fieldMapping };
}

/**
 * 逆向转换：将第三方厂商字段名转换回统一参数名。
 *
 * 根据 definitions 中的 third_party_field 反查原始 key。
 * 仅输出 definitions 中定义的参数。
 */
export function reverseTransformParams(
  thirdPartyParams: Record<string, any>,
  definitions: ParamDefinitions,
): Record<string, any> {
  // 构建反向映射：third_party_field -> 原始 key
  const reverseMap = new Map<string, string>();
  for (const [key, def] of Object.entries(definitions)) {
    const mappedKey = def.third_party_field ?? key;
    reverseMap.set(mappedKey, key);
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(thirdPartyParams)) {
    const originalKey = reverseMap.get(key);
    if (originalKey !== undefined) {
      result[originalKey] = value;
    }
  }

  return result;
}
