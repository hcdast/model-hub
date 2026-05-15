import {
  ALLOWED_PARAM_UI_TYPES,
  DefinitionValidationError,
  DefinitionValidationResult,
  ParamType,
} from '../interfaces/param-definition.interface';
import { sanitizeParamDefinitions } from './param-definitions-sanitize';

/** 允许的参数类型列表 */
const ALLOWED_TYPES: ParamType[] = ['string', 'number', 'boolean', 'array'];

/**
 * 校验 params 字段中每个 ParamDefinition 的结构合法性。
 *
 * 先对原始对象做「约束与 type 是否匹配」校验，再经 sanitize 后做 enum / enumDependsOn 等校验。
 */
export function validateParamDefinitions(
  params: Record<string, any>,
): DefinitionValidationResult {
  const errors: DefinitionValidationError[] = [];
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
    if (t !== 'number' && (def.min !== undefined || def.max !== undefined)) {
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
        } else if (def.enum !== undefined && Array.isArray(def.enum) && def.enum.length > 0) {
          const allowed = new Set(def.enum.map((v: unknown) => JSON.stringify(v)));
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
              if (!allowed.has(JSON.stringify(item))) {
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
