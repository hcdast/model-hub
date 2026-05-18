import {
  CHARACTER_SWAP_MODEL_TYPE,
  CHARACTER_SWAP_PATH_SEGMENTS,
  isCharacterSwapPathSegment,
  isCharacterSwapModelId,
} from '../constants/character-swap.constants';

export { CHARACTER_SWAP_PATH_SEGMENTS, isCharacterSwapPathSegment, isCharacterSwapModelId };

/** 路径末段 → 内部 featureType（snake_case，任务队列等） */
const PATH_SEGMENT_TO_INTERNAL: Record<string, string> = {
  'text-to-image': 'image_generate',
  'image-to-image': 'image_to_image',
  'text-to-video': 'text_to_video',
  'image-to-video': 'image_to_video',
  'reference-to-video': 'image_to_video',
  'video-to-video': 'image_to_video',
  'video-edit': 'image_to_video',
  'video-edit-fast': 'image_to_video',
  'video-upscale': 'video_upscale',
  'text-generate': 'text_generate',
  music: 'music',
  tts: 'tts',
  'talking-photo': 'talking_photo',
};

/** 路径末段 → model_configs.model_type / Adapter camelCase featureType */
const PATH_SEGMENT_TO_CAMEL: Record<string, string> = {
  'text-to-image': 'textToImage',
  'image-to-image': 'imageToImage',
  'text-to-video': 'textToVideo',
  'image-to-video': 'imageToVideo',
  'reference-to-video': 'referenceToVideo',
  'video-to-video': 'videoToVideo',
  'video-upscale': 'videoUpscale',
  'text-generate': 'textGenerate',
  music: 'music',
  tts: 'tts',
  'talking-photo': 'talkingPhoto',
};

/** @deprecated 路径型 model_id 仅作兼容 */
export function normalizeCharacterSwapPathSegment(segment: string): string {
  return isCharacterSwapPathSegment(segment) ? 'character-swap' : segment;
}

/** @deprecated 路径型 model_id 仅作兼容 */
export function normalizeCharacterSwapModelPath(modelPath: string): string {
  if (!modelPath || !modelPath.includes('/')) return modelPath;
  const parts = modelPath.split('/');
  const last = parts[parts.length - 1];
  if (isCharacterSwapPathSegment(last)) {
    parts[parts.length - 1] = 'character-swap';
    return parts.join('/');
  }
  return modelPath;
}

export function inferInternalFeatureFromPathSegment(lastSegment: string): string {
  if (isCharacterSwapPathSegment(lastSegment) || isCharacterSwapModelId(lastSegment)) {
    return 'character_swap';
  }
  return PATH_SEGMENT_TO_INTERNAL[lastSegment] ?? 'unknown';
}

export function inferCamelFeatureFromPathSegment(lastSegment: string): string {
  if (isCharacterSwapPathSegment(lastSegment) || isCharacterSwapModelId(lastSegment)) {
    return CHARACTER_SWAP_MODEL_TYPE;
  }
  return PATH_SEGMENT_TO_CAMEL[lastSegment] ?? 'textToImage';
}
