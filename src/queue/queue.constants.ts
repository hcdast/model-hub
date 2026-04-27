export const FEATURE_QUEUES = [
  'image-generate',
  'image-to-video',
  'character-swap',
  'video-upscale',
] as const;

export type FeatureQueueName = (typeof FEATURE_QUEUES)[number];

/** 与 ProviderRegistry 中各 Adapter.providerName 对齐 */
export const REGISTERED_PROVIDER_NAMES = [
  'wavespeed-ai',
  'cloudwise',
  'akool',
  'minimax',
  'seedance',
  'alibaba',
  'tencent-cloud',
] as const;

export type RegisteredProviderName = (typeof REGISTERED_PROVIDER_NAMES)[number];

export const BASE_QUEUE_TO_FEATURE_TYPE: Record<FeatureQueueName, string> = {
  'image-generate': 'image_generate',
  'image-to-video': 'image_to_video',
  'character-swap': 'character_swap',
  'video-upscale': 'video_upscale',
};

/** 全部「功能基队列:厂商」子队列，例如 image-generate:minimax */
export const ALL_PROVIDER_SUB_QUEUE_NAMES: readonly string[] = FEATURE_QUEUES.flatMap((base) =>
  REGISTERED_PROVIDER_NAMES.map((provider) => `${base}:${provider}`),
);

/** 与 ALL_PROVIDER_SUB_QUEUE_NAMES 相同，保留导出以兼容旧引用 */
export const PROVIDER_QUEUES = ALL_PROVIDER_SUB_QUEUE_NAMES;

export const ALL_SUBMIT_QUEUES = [
  'task-submit',
  ...FEATURE_QUEUES,
  ...ALL_PROVIDER_SUB_QUEUE_NAMES,
] as const;

export const FEATURE_TYPE_TO_QUEUE: Record<string, FeatureQueueName> = {
  image_generate: 'image-generate',
  image_to_video: 'image-to-video',
  text_to_video: 'image-to-video',
  character_swap: 'character-swap',
  video_upscale: 'video-upscale',
};

export const DEFAULT_QUEUE_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  timeout: 60000,
  removeOnComplete: { age: 3600, count: 10000 },
  removeOnFail: { age: 86400 },
};
