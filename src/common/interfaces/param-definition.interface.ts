// ===== 参数类型 =====

/** 参数类型枚举 */
export type ParamType = 'string' | 'number' | 'boolean' | 'array';

/** 客户端/管理端表单展示控件类型（可选；未设置时由运行时推断） */
export type ParamUIType =
  | 'select'
  | 'switch'
  | 'input-number'
  | 'slider'
  | 'input'
  | 'textarea'
  | 'tags'
  | 'radio'
  | 'password';

/** 允许的 ui_type 白名单（与校验器一致） */
export const ALLOWED_PARAM_UI_TYPES: readonly ParamUIType[] = [
  'select',
  'switch',
  'input-number',
  'slider',
  'input',
  'textarea',
  'tags',
  'radio',
  'password',
] as const;

/**
 * 本参数的 enum 可选项随另一参数的取值变化（可选，高级）。
 * 例：resolution 依赖 aspect_ratio 时，按画幅过滤可选分辨率列表。
 */
export interface ParamEnumDependsOn {
  /** 依赖的参数字段名，如 aspect_ratio */
  param: string;
  /** 依赖字段取值（字符串键）→ 本参数允许的 enum 子集 */
  map: Record<string, (string | number | boolean)[]>;
}

/** 单个参数定义 */
export interface ParamDefinition {
  required: boolean;
  type: ParamType;
  /** 管理端/客户端展示用短标题，缺省可用 description 或字段名 */
  label?: string;
  /** 显式指定前端控件类型；未设置则由客户端根据 type/enum 等推断 */
  ui_type?: ParamUIType;
  default?: any;
  description?: string;
  enum?: (string | number | boolean)[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** 数组最少/最多元素个数（仅 type=array） */
  minItems?: number;
  maxItems?: number;
  third_party_field?: string;
  hide?: boolean;
  /** 枚举随其他参数取值联动过滤（替代已废弃的 configs.resolutions 等） */
  enumDependsOn?: ParamEnumDependsOn;
  extra_credit_multiplier?: number;
  /** 标记为 true 时，创建任务时跳过该字段的参数校验（直接透传） */
  skipValidation?: boolean;
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
  label?: string;
  ui_type?: ParamUIType;
  default?: any;
  description?: string;
  enum?: (string | number | boolean)[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  enumDependsOn?: ParamEnumDependsOn;
}

/** 模型参数文档 */
export interface ModelParamDoc {
  model_id: string;
  model_type: string;
  provider: string;
  model_name: string;
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
