import { NodeType } from '../types/node-types';

/** 节点类型 → model_configs.model_type (camelCase) */
export const NODE_TYPE_TO_MODEL_TYPE: Partial<Record<NodeType, string>> = {
  'ai-chat': 'textGenerate',
  'script-writer': 'textGenerate',
  'storyboard': 'textGenerate',
  'text-to-image': 'textToImage',
  'image-to-image': 'imageToImage',
  'image-editor': 'imageToImage',
  'image-upscale': 'imageToImage',
  'text-to-video': 'textToVideo',
  'image-to-video': 'imageToVideo',
  'video-to-video': 'videoToVideo',
  'video-upscale': 'videoUpscale',
  'character-create': 'textToImage',
  'face-swap': 'headSwap',
  'character-swap': 'characterSwap',
  'text-to-speech': 'tts',
  'music-generation': 'music',
};

export function getModelTypeForNode(nodeType: NodeType): string | undefined {
  return NODE_TYPE_TO_MODEL_TYPE[nodeType];
}

export function nodeTypeSupportsModel(nodeType: NodeType): boolean {
  return nodeType in NODE_TYPE_TO_MODEL_TYPE;
}
