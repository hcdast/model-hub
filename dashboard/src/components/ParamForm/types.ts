/**
 * 参数表单组件类型定义（参数定义本体与后端 src/common 对齐）
 */

export type {
  ParamType,
  ParamDefinition,
  ParamDefinitions,
  ParamUIType,
} from '@model-hub/common/interfaces/param-definition.interface';

import type {
  ParamDefinition,
  ParamDefinitions,
} from '@model-hub/common/interfaces/param-definition.interface';

/** 单个参数字段属性 */
export interface ParamFieldProps {
  /** 参数名称（如 "prompt", "aspect_ratio"） */
  name: string;
  /** 参数定义 */
  definition: ParamDefinition;
  /** 是否禁用 */
  disabled?: boolean;
  /** 表单字段名前缀，默认为 ['params'] */
  fieldPrefix?: (string | number)[];
}
export interface ParamFormProps {
  /** 参数定义集合 */
  definitions: ParamDefinitions;
  /** 表单值（受控模式） */
  value?: Record<string, any>;
  /** 值变化回调 */
  onChange?: (value: Record<string, any>) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 表单布局 */
  layout?: 'vertical' | 'horizontal';
  /** 表单实例引用 */
  formRef?: React.RefObject<ParamFormInstance>;
}

/** 参数表单实例方法 */
export interface ParamFormInstance {
  /** 获取所有字段值 */
  getValues: () => Record<string, any>;
  /** 验证并获取字段值 */
  validateFields: () => Promise<Record<string, any>>;
  /** 设置字段值 */
  setValues: (values: Record<string, any>) => void;
  /** 重置字段 */
  resetFields: () => void;
}
