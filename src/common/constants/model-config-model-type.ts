/**
 * model_configs.model_type：与创建任务 options.featureType 一致的 camelCase 能力类型。
 */
export const MODEL_CONFIG_MODEL_TYPES = [
  'textToImage',
  'imageToImage',
  'textToVideo',
  'imageToVideo',
  'videoToVideo',
  'characterSwap',
  'headSwap',
  'videoUpscale',
  'textGenerate',
  'music',
  'tts',
  'talkingPhoto',
  'referenceToVideo',
  'imageUpscale',
] as const;

export type ModelConfigModelType = (typeof MODEL_CONFIG_MODEL_TYPES)[number];
