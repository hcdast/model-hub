import type { ParamDefinition as SharedDefinition, ParamDocItem as SharedDoc } from '../../../src/common/interfaces/param-definition.interface';
export type ParamDefinition = SharedDefinition;
export type ParamDocItem = SharedDoc & { hide?: boolean };
export interface ModelParamDoc { model_id: string; model_type: string; provider: string; model_name: string; params: ParamDocItem[] }

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
