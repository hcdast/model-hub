import {
  DefinitionValidationError,
  DefinitionValidationResult,
  ParamType,
} from '../interfaces/param-definition.interface';

/** 允许的参数类型列表 */
const ALLOWED_TYPES: ParamType[] = ['string', 'number', 'boolean', 'array'];

/**
 * 校验 params 字段中每个 ParamDefinition 的结构合法性。
 *
 * 校验规则：
 * 1. type 必须在允许列表中 (string/number/boolean/array)
 * 2. 如果设置了 enum 且有 default，default 必须在 enum 中
 * 3. 如果同时设置了 min 和 max，min 不能大于 max
 */
export function validateParamDefinitions(
  params: Record<string, any>,
): DefinitionValidationResult {
  const errors: DefinitionValidationError[] = [];

  for (const [paramName, def] of Object.entries(params)) {
    // 1. type 校验
    if (!ALLOWED_TYPES.includes(def.type)) {
      errors.push({
        paramName,
        field: 'type',
        message: `参数 ${paramName} 的 type 必须是 [${ALLOWED_TYPES.join(', ')}] 之一，实际为 ${def.type}`,
      });
    }

    // 2. enum + default 校验
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

    // 3. min <= max 校验
    if (
      def.min !== undefined &&
      def.max !== undefined &&
      def.min > def.max
    ) {
      errors.push({
        paramName,
        field: 'min/max',
        message: `参数 ${paramName} 的 min (${def.min}) 不能大于 max (${def.max})`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
