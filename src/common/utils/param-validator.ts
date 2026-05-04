import {
  ParamDefinitions,
  ParamValidationError,
  ParamValidationResult,
} from '../interfaces/param-definition.interface';

/**
 * 根据 ParamDefinitions 校验请求参数。
 *
 * 校验顺序：required → type → enum → range → length → 默认值填充 → 过滤未定义参数
 * 返回所有错误（非遇到第一个就停止）。
 */
export function validateParams(
  input: Record<string, any>,
  definitions: ParamDefinitions,
): ParamValidationResult {
  const errors: ParamValidationError[] = [];
  const sanitized: Record<string, any> = {};

  for (const [field, def] of Object.entries(definitions)) {
    const value = input[field];
    const provided = field in input && value !== undefined && value !== null;

    // 0. skipValidation: 跳过校验，直接透传值或填充默认值
    if (def.skipValidation) {
      if (provided) {
        sanitized[field] = value;
      } else if (def.default !== undefined) {
        sanitized[field] = def.default;
      }
      continue;
    }

    // 如果未提供，优先填充默认值；无默认值且必填时才报错
    if (!provided) {
      if (def.default !== undefined) {
        sanitized[field] = def.default;
      } else if (def.required) {
        errors.push({ field, message: `${field} 是必填参数` });
      }
      continue;
    }

    // 2. 类型检查
    if (!checkType(value, def.type)) {
      errors.push({
        field,
        message: `${field} 期望类型 ${def.type}，实际为 ${typeof value}`,
        expected: def.type,
        actual: typeof value,
      });
      continue; // 类型不对，跳过后续约束校验
    }

    // 3. 枚举检查
    if (def.enum && def.enum.length > 0 && !def.enum.includes(value)) {
      errors.push({
        field,
        message: `${field} 的值必须是 [${def.enum.join(', ')}] 之一`,
        expected: def.enum,
        actual: value,
      });
    }

    // 4. 范围检查 (number)
    if (def.type === 'number') {
      if (def.min !== undefined && value < def.min) {
        errors.push({
          field,
          message: `${field} 的值必须在 ${def.min} 到 ${def.max ?? '∞'} 之间`,
          expected: { min: def.min, max: def.max },
          actual: value,
        });
      }
      if (def.max !== undefined && value > def.max) {
        errors.push({
          field,
          message: `${field} 的值必须在 ${def.min ?? '-∞'} 到 ${def.max} 之间`,
          expected: { min: def.min, max: def.max },
          actual: value,
        });
      }
    }

    // 5. 长度检查 (string)
    if (def.type === 'string' && typeof value === 'string') {
      if (def.minLength !== undefined && value.length < def.minLength) {
        errors.push({
          field,
          message: `${field} 的长度不能小于 ${def.minLength}`,
          expected: { minLength: def.minLength },
          actual: value.length,
        });
      }
      if (def.maxLength !== undefined && value.length > def.maxLength) {
        errors.push({
          field,
          message: `${field} 的长度不能大于 ${def.maxLength}`,
          expected: { maxLength: def.maxLength },
          actual: value.length,
        });
      }
    }

    // 通过校验，加入 sanitized
    sanitized[field] = value;
  }

  // 6 & 7: 默认值已在循环中填充，未定义参数已被过滤（只遍历 definitions 的 key）

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}

/** 检查值是否匹配指定的 ParamType */
function checkType(value: any, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    default:
      return false;
  }
}
