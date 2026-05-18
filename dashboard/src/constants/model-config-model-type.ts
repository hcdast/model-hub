/** 与后端 model_configs.model_type 一致 */
export const MODEL_CONFIG_MODEL_TYPES = [
  'textToImage',
  'imageToImage',
  'textToVideo',
  'imageToVideo',
  'videoToVideo',
  'characterSwap',
  'videoUpscale',
  'textGenerate',
  'music',
  'tts',
  'talkingPhoto',
  'referenceToVideo',
  'imageUpscale',
] as const;

export type ModelConfigModelType = (typeof MODEL_CONFIG_MODEL_TYPES)[number];
