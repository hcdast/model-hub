// ===== 参数类型 =====

/** 参数类型枚举 */
export type ParamType = 'string' | 'number' | 'boolean' | 'array';

/** 枚举值的扩展配置 */
export interface ParamConfigItem {
  value: string | number | boolean;
  label: string;
  default?: boolean;
  unit_credit?: number;
  original_unit_credit?: number;
  unit_duration?: number;
  resolutions?: string[];
  [key: string]: any;
}

/** 单个参数定义 */
export interface ParamDefinition {
  required: boolean;
  type: ParamType;
  default?: any;
  description?: string;
  enum?: (string | number | boolean)[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  third_party_field?: string;
  hide?: boolean;
  configs?: ParamConfigItem[];
  extra_credit_multiplier?: number;
}

/** 模型参数定义集合 */
export type ParamDefinitions = Record<string, ParamDefinition>;

// ===== 校验结果 =====

/** 参数校验错误 */
export interface ParamValidationError {
  field: string;
  message: string;
  expected?: any;
  actual?: any;
}

/** 参数校验结果 */
export interface ParamValidationResult {
  valid: boolean;
  errors: ParamValidationError[];
  sanitized: Record<string, any>;
}

// ===== 转换结果 =====

/** 参数转换结果 */
export interface TransformResult {
  transformed: Record<string, any>;
  fieldMapping: Record<string, string>;
}

// ===== 文档生成 =====

/** 单个参数文档项 */
export interface ParamDocItem {
  name: string;
  type: ParamType;
  required: boolean;
  default?: any;
  description?: string;
  enum?: (string | number | boolean)[];
  min?: number;
  max?: number;
  configs?: ParamConfigItem[];
}

/** 模型参数文档 */
export interface ModelParamDoc {
  model_name: string;
  model_type: number;
  provider: string;
  label: string;
  params: ParamDocItem[];
}

// ===== 定义校验 =====

/** 参数定义校验错误 */
export interface DefinitionValidationError {
  paramName: string;
  field: string;
  message: string;
}

/** 参数定义校验结果 */
export interface DefinitionValidationResult {
  valid: boolean;
  errors: DefinitionValidationError[];
}
