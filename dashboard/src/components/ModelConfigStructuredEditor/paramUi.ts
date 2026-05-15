import type {
  ParamType,
  ParamUIType,
} from '@model-hub/common/interfaces/param-definition.interface';

const STRING_UIS: ParamUIType[] = [
  'input',
  'textarea',
  'password',
  'radio',
  'select',
];
const NUMBER_UIS: ParamUIType[] = [
  'input-number',
  'slider',
  'radio',
  'select',
];
const BOOL_UIS: ParamUIType[] = ['switch', 'radio'];
const ARRAY_UIS: ParamUIType[] = ['tags'];

/** 展示控件中文说明（管理端下拉用） */
export const PARAM_UI_TYPE_LABELS: Record<ParamUIType, string> = {
  select: '下拉列表',
  switch: '开关',
  'input-number': '数字输入框',
  slider: '滑块',
  input: '单行文本',
  textarea: '多行文本',
  tags: '标签列表（多值）',
  radio: '单选按钮组',
  password: '密码框',
};

export function defaultUiTypeForParamType(t: ParamType): ParamUIType {
  switch (t) {
    case 'boolean':
      return 'switch';
    case 'number':
      return 'input-number';
    case 'array':
      return 'tags';
    default:
      return 'input';
  }
}

export function uiOptionsForParamType(t: ParamType): ParamUIType[] {
  switch (t) {
    case 'string':
      return [...STRING_UIS];
    case 'number':
      return [...NUMBER_UIS];
    case 'boolean':
      return [...BOOL_UIS];
    case 'array':
      return [...ARRAY_UIS];
    default:
      return ['input'];
  }
}

/** 带中文标签的展示控件选项（供 Select 使用） */
export function labeledUiOptionsForParamType(
  t: ParamType,
): { label: string; value: ParamUIType }[] {
  return uiOptionsForParamType(t).map((value) => ({
    value,
    label: PARAM_UI_TYPE_LABELS[value] ?? value,
  }));
}

/** 数据类型中文（管理端） */
export const PARAM_TYPE_LABELS: Record<ParamType, string> = {
  string: '文本（string）',
  number: '数字（number）',
  boolean: '布尔（boolean）',
  array: '数组（array）',
};

/** 若当前 ui_type 与数据类型不兼容，则回退为类型默认控件 */
export function coerceUiType(
  t: ParamType,
  ui: ParamUIType | undefined,
): ParamUIType {
  const opts = uiOptionsForParamType(t);
  if (ui && opts.includes(ui)) return ui;
  return defaultUiTypeForParamType(t);
}
