export const catalogGroups = ['all', 'image', 'video', 'audio', 'text', 'character'] as const;
export type CatalogGroup = typeof catalogGroups[number];

export const catalogGroupLabels: Record<CatalogGroup, string> = {
  all: 'All models', image: 'Image', video: 'Video', audio: 'Audio', text: 'Text', character: 'Digital human',
};

/** Group only known capabilities; future types remain discoverable in All models. */
export function catalogGroup(type: string): Exclude<CatalogGroup, 'all'> | 'other' {
  if (['textToImage', 'imageToImage'].includes(type)) return 'image';
  if (['textToVideo', 'imageToVideo', 'videoToVideo', 'referenceToVideo'].includes(type)) return 'video';
  if (['tts', 'music'].includes(type)) return 'audio';
  if (type === 'textGenerate') return 'text';
  if (['talkingPhoto', 'characterSwap', 'headSwap'].includes(type)) return 'character';
  return 'other';
}

/** A stable visual per model, shared across providers of the same configuration. */
export function catalogVisualIndex(modelId: string, modelName: string, variants: number): number {
  let hash = 0;
  for (const character of `${modelId}:${modelName}`) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash % variants;
}
