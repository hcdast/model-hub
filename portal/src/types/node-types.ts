/**
 * 节点类型定义
 * 参考 TapNow 设计，面向 AI 内容创作场景
 */

// 节点分类
export type NodeCategory =
  | 'creative'      // 创意与脚本
  | 'image'         // 图像生成
  | 'video'         // 视频生成
  | 'character'     // 角色与场景
  | 'audio'         // 音频处理
  | 'post'          // 后期处理
  | 'io';           // 输入输出

// 节点类型
export type NodeType =
  // 创意与脚本
  | 'ai-chat'           // AI 对话/灵感
  | 'script-writer'     // 脚本生成
  | 'storyboard'        // 分镜生成
  // 图像生成
  | 'text-to-image'     // 文生图
  | 'image-to-image'    // 图生图
  | 'image-editor'      // 图片编辑
  | 'image-upscale'     // 图片超分
  // 视频生成
  | 'text-to-video'     // 文生视频
  | 'image-to-video'    // 图生视频
  | 'video-to-video'    // 视频生视频
  | 'video-upscale'     // 视频超分
  // 角色与场景
  | 'character-create'  // 创建角色
  | 'face-swap'         // 换脸
  | 'character-swap'    // 换装
  // 音频处理
  | 'text-to-speech'    // 文字转语音
  | 'music-generation'  // 音乐生成
  // 后期处理
  | 'transform'         // 数据转换
  | 'condition'         // 条件分支
  | 'loop'              // 循环处理
  // 输入输出
  | 'input'             // 工作流输入
  | 'output';           // 工作流输出

// 节点定义
export interface NodeDefinition {
  type: NodeType;
  category: NodeCategory;
  label: string;
  description: string;
  icon: string;           // 图标名称
  color: string;          // 主题色
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  defaultConfig?: Record<string, any>;
}

// 端口定义
export interface PortDefinition {
  name: string;
  label: string;
  dataType: 'string' | 'number' | 'boolean' | 'image' | 'video' | 'audio' | 'text' | 'json' | 'any';
  required?: boolean;
  multiple?: boolean;     // 是否支持多输入
}

// 节点配置
export interface NodeConfig {
  label?: string;
  modelId?: string;
  prompt?: string;
  negativePrompt?: string;
  parameters?: Record<string, any>;
  // AI Chat 特有
  agentType?: 'inspiration' | 'director' | 'optimizer';
  context?: string;
  // 图片特有
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  // 视频特有
  duration?: number;
  fps?: number;
  resolution?: string;
  // 角色特有
  characterImage?: string;
  // 音频特有
  voice?: string;
  language?: string;
  // 条件特有
  conditions?: Array<{ expression: string; branchId: string }>;
  // 循环特有
  loopConfig?: {
    inputArray: string;
    outputMode: 'collect' | 'last';
    parallelism: 'sequential' | 'parallel';
    maxConcurrency?: number;
  };
  // 转换特有
  expression?: string;
}

// 节点分组定义
export interface NodeGroup {
  category: NodeCategory;
  label: string;
  icon: string;
  nodes: NodeDefinition[];
}

// 所有节点定义
export const NODE_DEFINITIONS: NodeDefinition[] = [
  // ============ 创意与脚本 ============
  {
    type: 'ai-chat',
    category: 'creative',
    label: 'AI Chat',
    description: 'AI 对话生成创意、脚本、提示词',
    icon: 'MessageOutlined',
    color: '#6366f1',
    inputs: [
      { name: 'context', label: '上下文', dataType: 'text', required: false },
    ],
    outputs: [
      { name: 'text', label: '文本输出', dataType: 'text' },
      { name: 'json', label: 'JSON 输出', dataType: 'json' },
    ],
    defaultConfig: {
      agentType: 'inspiration',
      prompt: '',
    },
  },
  {
    type: 'script-writer',
    category: 'creative',
    label: 'Script Writer',
    description: '自动生成广告/视频脚本',
    icon: 'FileTextOutlined',
    color: '#8b5cf6',
    inputs: [
      { name: 'topic', label: '主题', dataType: 'text', required: true },
      { name: 'style', label: '风格', dataType: 'text', required: false },
      { name: 'duration', label: '时长', dataType: 'number', required: false },
    ],
    outputs: [
      { name: 'script', label: '脚本', dataType: 'text' },
      { name: 'scenes', label: '分镜列表', dataType: 'json' },
    ],
  },
  {
    type: 'storyboard',
    category: 'creative',
    label: 'Storyboard',
    description: '生成九宫格分镜图',
    icon: 'LayoutOutlined',
    color: '#a78bfa',
    inputs: [
      { name: 'script', label: '脚本', dataType: 'text', required: true },
      { name: 'style', label: '风格参考', dataType: 'image', required: false },
    ],
    outputs: [
      { name: 'storyboard', label: '分镜图', dataType: 'image' },
      { name: 'descriptions', label: '分镜描述', dataType: 'json' },
    ],
  },

  // ============ 图像生成 ============
  {
    type: 'text-to-image',
    category: 'image',
    label: 'Text to Image',
    description: '文字生成图片',
    icon: 'PictureOutlined',
    color: '#f59e0b',
    inputs: [
      { name: 'prompt', label: '提示词', dataType: 'text', required: true },
      { name: 'negative_prompt', label: '负面提示词', dataType: 'text', required: false },
      { name: 'reference', label: '参考图', dataType: 'image', required: false },
    ],
    outputs: [
      { name: 'image', label: '生成图片', dataType: 'image' },
    ],
    defaultConfig: {
      width: 1024,
      height: 1024,
      steps: 30,
      cfgScale: 7,
    },
  },
  {
    type: 'image-to-image',
    category: 'image',
    label: 'Image to Image',
    description: '图片风格转换',
    icon: 'SwapOutlined',
    color: '#f97316',
    inputs: [
      { name: 'image', label: '输入图片', dataType: 'image', required: true },
      { name: 'prompt', label: '提示词', dataType: 'text', required: true },
      { name: 'strength', label: '强度', dataType: 'number', required: false },
    ],
    outputs: [
      { name: 'image', label: '输出图片', dataType: 'image' },
    ],
    defaultConfig: {
      strength: 0.75,
    },
  },
  {
    type: 'image-editor',
    category: 'image',
    label: 'Image Editor',
    description: '局部编辑、焦点编辑',
    icon: 'EditOutlined',
    color: '#fb923c',
    inputs: [
      { name: 'image', label: '输入图片', dataType: 'image', required: true },
      { name: 'mask', label: '遮罩', dataType: 'image', required: true },
      { name: 'prompt', label: '编辑提示', dataType: 'text', required: true },
    ],
    outputs: [
      { name: 'image', label: '编辑后图片', dataType: 'image' },
    ],
  },
  {
    type: 'image-upscale',
    category: 'image',
    label: 'Image Upscale',
    description: '图片超分辨率',
    icon: 'ZoomInOutlined',
    color: '#fbbf24',
    inputs: [
      { name: 'image', label: '输入图片', dataType: 'image', required: true },
    ],
    outputs: [
      { name: 'image', label: '高清图片', dataType: 'image' },
    ],
    defaultConfig: {
      scale: 2,
    },
  },

  // ============ 视频生成 ============
  {
    type: 'text-to-video',
    category: 'video',
    label: 'Text to Video',
    description: '文字生成视频',
    icon: 'VideoCameraOutlined',
    color: '#3b82f6',
    inputs: [
      { name: 'prompt', label: '提示词', dataType: 'text', required: true },
      { name: 'reference', label: '参考图', dataType: 'image', required: false },
    ],
    outputs: [
      { name: 'video', label: '生成视频', dataType: 'video' },
    ],
    defaultConfig: {
      duration: 4,
      fps: 24,
      resolution: '720p',
    },
  },
  {
    type: 'image-to-video',
    category: 'video',
    label: 'Image to Video',
    description: '图片转视频',
    icon: 'PlayCircleOutlined',
    color: '#60a5fa',
    inputs: [
      { name: 'image', label: '输入图片', dataType: 'image', required: true },
      { name: 'prompt', label: '运动描述', dataType: 'text', required: false },
      { name: 'end_image', label: '结束帧', dataType: 'image', required: false },
    ],
    outputs: [
      { name: 'video', label: '生成视频', dataType: 'video' },
    ],
    defaultConfig: {
      duration: 4,
      fps: 24,
    },
  },
  {
    type: 'video-to-video',
    category: 'video',
    label: 'Video to Video',
    description: '视频风格转换',
    icon: 'SyncOutlined',
    color: '#93c5fd',
    inputs: [
      { name: 'video', label: '输入视频', dataType: 'video', required: true },
      { name: 'prompt', label: '风格描述', dataType: 'text', required: true },
      { name: 'reference', label: '风格参考', dataType: 'image', required: false },
    ],
    outputs: [
      { name: 'video', label: '输出视频', dataType: 'video' },
    ],
  },
  {
    type: 'video-upscale',
    category: 'video',
    label: 'Video Upscale',
    description: '视频超分辨率',
    icon: 'ExpandOutlined',
    color: '#bfdbfe',
    inputs: [
      { name: 'video', label: '输入视频', dataType: 'video', required: true },
    ],
    outputs: [
      { name: 'video', label: '高清视频', dataType: 'video' },
    ],
    defaultConfig: {
      scale: 2,
    },
  },

  // ============ 角色与场景 ============
  {
    type: 'character-create',
    category: 'character',
    label: 'Character Create',
    description: '创建 AI 角色',
    icon: 'UserOutlined',
    color: '#ec4899',
    inputs: [
      { name: 'prompt', label: '角色描述', dataType: 'text', required: true },
      { name: 'reference', label: '参考图', dataType: 'image', required: false },
    ],
    outputs: [
      { name: 'character', label: '角色图片', dataType: 'image' },
      { name: 'character_id', label: '角色 ID', dataType: 'string' },
    ],
  },
  {
    type: 'face-swap',
    category: 'character',
    label: 'Face Swap',
    description: '换脸',
    icon: 'SwapOutlined',
    color: '#f472b6',
    inputs: [
      { name: 'source', label: '源图片/视频', dataType: 'image', required: true },
      { name: 'face', label: '目标脸部', dataType: 'image', required: true },
    ],
    outputs: [
      { name: 'result', label: '换脸结果', dataType: 'image' },
    ],
  },
  {
    type: 'character-swap',
    category: 'character',
    label: 'Character Swap',
    description: '换装',
    icon: 'SkinOutlined',
    color: '#fb7185',
    inputs: [
      { name: 'image', label: '输入图片', dataType: 'image', required: true },
      { name: 'clothing', label: '服装参考', dataType: 'image', required: true },
    ],
    outputs: [
      { name: 'result', label: '换装结果', dataType: 'image' },
    ],
  },

  // ============ 音频处理 ============
  {
    type: 'text-to-speech',
    category: 'audio',
    label: 'Text to Speech',
    description: '文字转语音',
    icon: 'AudioOutlined',
    color: '#14b8a6',
    inputs: [
      { name: 'text', label: '文本', dataType: 'text', required: true },
    ],
    outputs: [
      { name: 'audio', label: '音频', dataType: 'audio' },
    ],
    defaultConfig: {
      voice: 'default',
      language: 'zh-CN',
      speed: 1.0,
    },
  },
  {
    type: 'music-generation',
    category: 'audio',
    label: 'Music Generation',
    description: '生成背景音乐',
    icon: 'CustomerServiceOutlined',
    color: '#2dd4bf',
    inputs: [
      { name: 'prompt', label: '音乐描述', dataType: 'text', required: true },
      { name: 'duration', label: '时长', dataType: 'number', required: false },
    ],
    outputs: [
      { name: 'audio', label: '音乐', dataType: 'audio' },
    ],
    defaultConfig: {
      duration: 30,
    },
  },

  // ============ 后期处理 ============
  {
    type: 'transform',
    category: 'post',
    label: 'Transform',
    description: '数据转换',
    icon: 'ToolOutlined',
    color: '#722ed1',
    inputs: [
      { name: 'input', label: '输入', dataType: 'any', required: true },
    ],
    outputs: [
      { name: 'output', label: '输出', dataType: 'any' },
    ],
  },
  {
    type: 'condition',
    category: 'post',
    label: 'Condition',
    description: '条件分支',
    icon: 'BranchesOutlined',
    color: '#52c41a',
    inputs: [
      { name: 'input', label: '输入', dataType: 'any', required: true },
    ],
    outputs: [
      { name: 'true', label: 'True', dataType: 'any' },
      { name: 'false', label: 'False', dataType: 'any' },
    ],
  },
  {
    type: 'loop',
    category: 'post',
    label: 'Loop',
    description: '循环处理',
    icon: 'ReloadOutlined',
    color: '#faad14',
    inputs: [
      { name: 'array', label: '数组', dataType: 'json', required: true },
    ],
    outputs: [
      { name: 'result', label: '结果', dataType: 'json' },
    ],
  },

  // ============ 输入输出 ============
  {
    type: 'input',
    category: 'io',
    label: 'Input',
    description: '工作流输入',
    icon: 'ImportOutlined',
    color: '#13c2c2',
    inputs: [],
    outputs: [
      { name: 'output', label: '输出', dataType: 'any' },
    ],
  },
  {
    type: 'output',
    category: 'io',
    label: 'Output',
    description: '工作流输出',
    icon: 'ExportOutlined',
    color: '#eb2f96',
    inputs: [
      { name: 'input', label: '输入', dataType: 'any', required: true },
    ],
    outputs: [],
  },
];

// 节点分组
export const NODE_GROUPS: NodeGroup[] = [
  {
    category: 'creative',
    label: '创意与脚本',
    icon: 'BulbOutlined',
    nodes: NODE_DEFINITIONS.filter(n => n.category === 'creative'),
  },
  {
    category: 'image',
    label: '图像生成',
    icon: 'PictureOutlined',
    nodes: NODE_DEFINITIONS.filter(n => n.category === 'image'),
  },
  {
    category: 'video',
    label: '视频生成',
    icon: 'VideoCameraOutlined',
    nodes: NODE_DEFINITIONS.filter(n => n.category === 'video'),
  },
  {
    category: 'character',
    label: '角色与场景',
    icon: 'UserOutlined',
    nodes: NODE_DEFINITIONS.filter(n => n.category === 'character'),
  },
  {
    category: 'audio',
    label: '音频处理',
    icon: 'AudioOutlined',
    nodes: NODE_DEFINITIONS.filter(n => n.category === 'audio'),
  },
  {
    category: 'post',
    label: '后期处理',
    icon: 'ToolOutlined',
    nodes: NODE_DEFINITIONS.filter(n => n.category === 'post'),
  },
];

// 根据类型获取节点定义
export function getNodeDefinition(type: NodeType): NodeDefinition | undefined {
  return NODE_DEFINITIONS.find(n => n.type === type);
}

// 获取节点分组
export function getNodeGroups(): NodeGroup[] {
  return NODE_GROUPS;
}
