/** Akool 换头/换全身：统一入参 → 算法 data 字段 */

export type AkoolSwapMappingInput = {
  obj_id: number;
  image?: string;
  img_url?: string;
};

export function isAkoolSwapModelId(modelId: string | undefined | null): boolean {
  if (modelId == null || String(modelId).trim() === '') return false;
  const id = String(modelId).trim().toLowerCase();
  return (
    id.endsWith('/headswap')
    || id.endsWith('/head-swap')
    || id === 'akool-premium'
    || id === 'akool-premium-multi-person'
    || id.includes('akool-premium')
  );
}

/** 兼容 AGI 旧字段名：video_url、img_url、type(head|person) */
export function normalizeAkoolSwapClientInput(input: Record<string, any>): void {
  if (input.video == null && input.video_url != null) {
    input.video = input.video_url;
  }
  if (input.swap_type == null && typeof input.type === 'string') {
    if (input.type === 'head' || input.type === 'person') {
      input.swap_type = input.type;
    }
  }
  if (Array.isArray(input.mappings)) {
    input.mappings = input.mappings.map((item: AkoolSwapMappingInput) => {
      if (item == null || typeof item !== 'object') return item;
      if (item.image == null && item.img_url != null) {
        return { ...item, image: item.img_url };
      }
      return item;
    });
  }
}

export function buildAkoolSwapAlgorithmData(
  input: Record<string, any>,
  modelId: string,
): Record<string, any> {
  const videoUrl = input.video_url ?? input.video;
  const swapType =
    input.sam3_prompt
    ?? input.swap_type
    ?? (String(modelId).includes('multi-person') ? 'person' : 'head');

  const mappings = (Array.isArray(input.mappings) ? input.mappings : []).map(
    (m: AkoolSwapMappingInput) => {
      const imageUrl = m?.image ?? m?.img_url;
      return {
        obj_id: m?.obj_id,
        img_urls: imageUrl ? [imageUrl] : [],
      };
    },
  );

  const data: Record<string, any> = {
    video_url: videoUrl,
    mappings,
    mask_expand: input.mask_expand ?? 40,
    block_size: input.block_size ?? 16,
    seed: input.seed ?? 28588,
    positive_prompt: input.positive_prompt ?? input.prompt ?? 'Generate a character animation',
    sam3_prompt: swapType,
    sam3_direction: input.sam3_direction ?? 'forward',
    score_threshold_detection: input.score_threshold_detection ?? 0.64,
    new_det_thresh: input.new_det_thresh ?? 0.9,
    resolution: input.resolution ?? '720p',
  };

  return data;
}

export function resolveAkoolSwapSubmitOptions(
  modelId: string,
  options?: Record<string, any>,
): Record<string, any> {
  if (!isAkoolSwapModelId(modelId)) {
    return options ?? {};
  }
  return {
    algorithmFrom: 'characterSwap',
    algorithmType: 'characterSwap',
    taskName: 'swap_generate',
    queueName: 'swap_generate',
    ...options,
  };
}
