import { MODEL_CONFIG_MODEL_TYPES, ModelConfigModelType } from '../constants/model-config-model-type';

const SNAKE_TO_CAMEL: Record<string, ModelConfigModelType> = {
  image_generate: 'textToImage',
  image_to_image: 'imageToImage',
  text_to_video: 'textToVideo',
  image_to_video: 'imageToVideo',
  character_swap: 'characterSwap',
  head_swap: 'headSwap',
  video_upscale: 'videoUpscale',
};

const ALLOWED = new Set<string>(MODEL_CONFIG_MODEL_TYPES);

export function isModelConfigModelType(v: string): v is ModelConfigModelType {
  return ALLOWED.has(v);
}

/**
 * 将内部 featureType（snake）转为 model_configs.model_type（camelCase）。
 */
export function internalFeatureTypeToConfigModelType(internal: string): ModelConfigModelType | null {
  return SNAKE_TO_CAMEL[internal] ?? null;
}

/**
 * 从创建任务的 options.featureType 解析 model_configs 查询用的 camelCase model_type。
 */
export function resolveConfigModelTypeFromOptions(
  optionsFeatureType: string | undefined,
): ModelConfigModelType | null {
  if (optionsFeatureType == null || typeof optionsFeatureType !== 'string') return null;
  const raw = optionsFeatureType.trim();
  if (raw === '') return null;

  if (ALLOWED.has(raw)) return raw as ModelConfigModelType;

  if (/^(image_generate|image_to_image|text_to_video|image_to_video|character_swap|head_swap|video_upscale|unknown)$/.test(raw)) {
    return SNAKE_TO_CAMEL[raw] ?? null;
  }

  return null;
}

/**
 * 结合路径推断的 internal featureType 与 options.featureType，得到用于查询 model_configs 的 model_type。
 */
export function resolveConfigModelTypeForLookup(
  internalFeatureType: string,
  optionsFeatureType?: string,
): ModelConfigModelType | null {
  const fromOpt = resolveConfigModelTypeFromOptions(optionsFeatureType);
  if (fromOpt) return fromOpt;
  return internalFeatureTypeToConfigModelType(internalFeatureType);
}
