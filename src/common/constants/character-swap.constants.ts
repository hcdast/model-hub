/** 角色换装 model_id 末段 */
export const CHARACTER_SWAP_MODEL_SUFFIX = 'characterswap';
export const CHARACTER_SWAP_MODEL_TYPE = 'characterSwap';
export const LEGACY_CHARACTER_SWAP_MODEL_TYPE = 'characterFaceswap';

export const CHARACTER_SWAP_PATH_SEGMENTS = new Set([
  'characterswap',
  'character-swap',
  'motion-control',
  'animate',
  'character-faceswap',
]);

export function isCharacterSwapModelType(modelType: string | undefined | null): boolean {
  const t = modelType != null ? String(modelType).trim() : '';
  return t === CHARACTER_SWAP_MODEL_TYPE || t === LEGACY_CHARACTER_SWAP_MODEL_TYPE;
}

export function isCharacterSwapPathSegment(segment: string): boolean {
  return CHARACTER_SWAP_PATH_SEGMENTS.has(segment);
}

export function isCharacterSwapModelId(modelId: string | undefined | null): boolean {
  if (modelId == null || String(modelId).trim() === '') return false;
  const last = String(modelId).trim().split('/').pop()!;
  return isCharacterSwapPathSegment(last);
}
