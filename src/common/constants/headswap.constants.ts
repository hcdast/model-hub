/** Head Swap model_id 末段 */
export const HEAD_SWAP_MODEL_SUFFIX = 'headswap';
export const HEAD_SWAP_MODEL_TYPE = 'headSwap';

export const HEAD_SWAP_PATH_SEGMENTS = new Set(['headswap', 'head-swap']);

export function isHeadswapModelType(modelType: string | undefined | null): boolean {
  const t = modelType != null ? String(modelType).trim() : '';
  return t === HEAD_SWAP_MODEL_TYPE;
}

export function isHeadswapPathSegment(segment: string): boolean {
  return HEAD_SWAP_PATH_SEGMENTS.has(segment);
}

export function isHeadswapModelId(modelId: string | undefined | null): boolean {
  if (modelId == null || String(modelId).trim() === '') return false;
  const last = String(modelId).trim().split('/').pop()!;
  return isHeadswapPathSegment(last);
}
