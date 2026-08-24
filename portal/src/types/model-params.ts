/** 与后端 ParamDefinition 对齐的精简类型 */
export interface ParamDefinition {
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'array';
  label?: string;
  ui_type?: string;
  default?: unknown;
  description?: string;
  enum?: (string | number | boolean)[];
  min?: number;
  max?: number;
  hide?: boolean;
  enumDependsOn?: {
    param: string;
    map: Record<string, (string | number | boolean)[]>;
  };
}

export interface ParamDocItem {
  name: string;
  type: ParamDefinition['type'];
  required: boolean;
  label?: string;
  ui_type?: string;
  default?: unknown;
  description?: string;
  enum?: (string | number | boolean)[];
  min?: number;
  max?: number;
  enumDependsOn?: ParamDefinition['enumDependsOn'];
}

export interface ModelParamDoc {
  model_id: string;
  model_type: string;
  provider: string;
  model_name: string;
  params: ParamDocItem[];
}

/** 不在底部工具栏展示的参数字段 */
export const SKIP_FOOTER_PARAMS = new Set([
  'prompt',
  'negative_prompt',
  'negativePrompt',
  'text',
  'image',
  'video',
  'audio',
  'reference',
  'reference_image',
  'referenceImage',
  'input_image',
  'inputImage',
  'callbackUrl',
  'callback_url',
]);

/** 底部参数展示优先级 */
export const PARAM_DISPLAY_PRIORITY = [
  'aspect_ratio',
  'resolution',
  'size',
  'width',
  'height',
  'duration',
  'fps',
  'style',
  'quality',
  'mode',
  'seed',
];
