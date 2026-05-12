import { ValidationResult, ValidationError } from '../interfaces/validation.interface';
import { validateMandatoryUnitPriceMap } from '../../billing/unit-price-map.util';

/**
 * 模型配置验证工具类
 */
export class ModelConfigValidator {
  /**
   * 验证配置数据
   * @param config 配置对象
   * @returns 验证结果
   */
  static validateConfig(config: Record<string, any>): ValidationResult {
    const errors: ValidationError[] = [];

    const requiredFields = ['model_name', 'model_type', 'provider', 'label', 'service'];
    for (const field of requiredFields) {
      if (!config[field]) {
        errors.push({
          field,
          message: `${field} 不能为空`,
          value: config[field],
        });
      }
    }

    if (config.model_type !== undefined && typeof config.model_type !== 'number') {
      errors.push({
        field: 'model_type',
        message: 'model_type 必须是数字类型',
        value: config.model_type,
      });
    }

    if (config.sort !== undefined && typeof config.sort !== 'number') {
      errors.push({
        field: 'sort',
        message: 'sort 必须是数字类型',
        value: config.sort,
      });
    }

    if (config.disabled !== undefined && typeof config.disabled !== 'boolean') {
      errors.push({
        field: 'disabled',
        message: 'disabled 必须是布尔类型',
        value: config.disabled,
      });
    }

    if (config.tags !== undefined && !Array.isArray(config.tags)) {
      errors.push({
        field: 'tags',
        message: 'tags 必须是数组类型',
        value: config.tags,
      });
    }

    if (config.unit_price_map !== undefined && typeof config.unit_price_map !== 'object') {
      errors.push({
        field: 'unit_price_map',
        message: 'unit_price_map 必须是对象类型',
        value: config.unit_price_map,
      });
    }

    const upmCheck = validateMandatoryUnitPriceMap(config.unit_price_map);
    if (!upmCheck.valid) {
      for (const msg of upmCheck.errors) {
        errors.push({ field: 'unit_price_map', message: msg, value: config.unit_price_map });
      }
    }

    if (config.params !== undefined && typeof config.params !== 'object') {
      errors.push({
        field: 'params',
        message: 'params 必须是对象类型',
        value: config.params,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 验证 JSON 语法
   * @param jsonString JSON 字符串
   * @returns 验证结果
   */
  static validateJsonSyntax(jsonString: string): { valid: boolean; error?: string } {
    try {
      JSON.parse(jsonString);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'JSON 解析失败',
      };
    }
  }
}
