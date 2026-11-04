import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { ModelConfig } from '../database/schemas/model-config.schema';
import { WorkflowTemplate } from '../database/schemas/workflow-template.schema';
import { WorkflowNodeType } from '../database/schemas/workflow.schema';
import { validateParams } from '../common/utils/param-validator';

type CatalogModel = Pick<ModelConfig, 'model_id' | 'model_type' | 'provider' | 'model_name' | 'params' | 'params_rules' | 'revision' | 'disabled'> & { _id: unknown };
interface Recipe {
  key: string; name: string; description: string; category: string;
  scenario: WorkflowTemplate['scenario']; model: string; feature: string; provider: string;
  nodeType: WorkflowNodeType; output: 'image' | 'video' | 'audio' | 'text';
  tags: string[]; prompt: string; mediaField?: string; parameters?: Record<string, unknown>;
}

const recipes: Recipe[] = [
  { key: 'product-scene', name: '商品场景图改造', category: 'Image', scenario: 'ecommerce',
    description: '提供商品图片与场景描述，通过图生图制作新的商品展示画面。',
    model: 'akool/image-to-image', feature: 'imageToImage', provider: 'akool', nodeType: 'image-to-image', output: 'image', mediaField: 'source_image',
    tags: ['商品图', '场景改造', '图生图'], prompt: '保留参考图中商品的形状、颜色和标识，将商品放在浅米色摄影台上，柔和的自然光，简洁的电商展示构图。', parameters: { image_quantity: 1, aspect_ratio: '1:1' } },
  { key: 'marketing-visual', name: '营销视觉灵感图', category: 'Image', scenario: 'marketing',
    description: '描述品牌风格、主体和构图，生成用于营销创作的视觉草图。',
    model: 'akool/text-to-image', feature: 'textToImage', provider: 'akool', nodeType: 'text-to-image', output: 'image',
    tags: ['营销', '视觉创意', '文生图'], prompt: '为夏日气泡水设计一张清新的产品视觉草图，透明玻璃瓶、青柠和水滴，浅绿色背景，自然光，竖版构图，顶部留白用于后续排版，不生成文字。', parameters: { image_quantity: 1, aspect_ratio: '3:4', resolution: '1080p' } },
  { key: 'character-concept', name: '原创角色概念设计', category: 'Image', scenario: 'character',
    description: '用文字定义外观、服饰和画风，生成原创角色的概念画面。',
    model: 'akool/text-to-image', feature: 'textToImage', provider: 'akool', nodeType: 'text-to-image', output: 'image',
    tags: ['角色设计', '概念图', '文生图'], prompt: '原创科幻探险家角色概念图，银灰色短发，橙色轻便宇航服，背着工具包，全身正面站姿，简洁浅灰背景，细致的数字插画。', parameters: { image_quantity: 1, aspect_ratio: '3:4', resolution: '1080p' } },
  { key: 'photo-restyle', name: '图片风格重绘', category: 'Image', scenario: 'image',
    description: '上传参考图片，描述目标风格，生成保留主体构图的重绘图片。',
    model: 'akool/image-to-image', feature: 'imageToImage', provider: 'akool', nodeType: 'image-to-image', output: 'image', mediaField: 'source_image',
    tags: ['风格化', '图片处理', '图生图'], prompt: '保留参考图片的主体与基本构图，重绘为柔和的水彩插画风格，纸张纹理，温暖自然的色调。', parameters: { image_quantity: 1, aspect_ratio: '1:1' } },
  { key: 'text-short-video', name: '文字生成短片', category: 'Video', scenario: 'video',
    description: '描述主体动作、场景和镜头运动，生成一段 5 秒视频。',
    model: 'AkoolText2VideoFastV1/text-to-video', feature: 'textToVideo', provider: 'akool', nodeType: 'text-to-video', output: 'video',
    tags: ['短片', '镜头创作', '文生视频'], prompt: '清晨的海边，一只白色海鸟从平静海面飞起，金色阳光照亮翅膀，镜头缓慢向前推进，写实电影风格。', parameters: { duration: 5, duration_seconds: 5, resolution: '1280*720', generate_audio: false } },
  { key: 'product-motion', name: '商品图片转动态视频', category: 'Video', scenario: 'ecommerce',
    description: '提供商品主图与运动描述，生成 5 秒商品展示视频。',
    model: 'AkoolImage2VideoFastV1/image-to-video', feature: 'imageToVideo', provider: 'akool', nodeType: 'image-to-video', output: 'video', mediaField: 'image',
    tags: ['商品视频', '电商', '图生视频'], prompt: '保持商品外观与背景稳定，镜头缓慢环绕并轻微推进，柔和的光线掠过商品表面，平稳自然的产品展示。', parameters: { duration: 5, duration_seconds: 5, resolution: '720p', generate_audio: false } },
  { key: 'voiceover', name: '文案转语音配音', category: 'Audio', scenario: 'audio',
    description: '输入需要朗读的文案，通过 ElevenLabs 合成语音，适合解说和配音素材制作。',
    model: 'elevenlabs/tts', feature: 'tts', provider: 'elevenlabs', nodeType: 'text-to-speech', output: 'audio',
    tags: ['配音', '语音合成', 'ElevenLabs'], prompt: '欢迎来到我们的创意工作室。让灵感成为画面，让故事拥有声音。' },
  { key: 'marketing-copy', name: '营销文案起草', category: 'Text', scenario: 'marketing',
    description: '提供产品信息、目标受众和语气要求，生成可继续修改的营销文案。',
    model: 'gemini-3.1-pro/text-generate', feature: 'textGenerate', provider: 'akool', nodeType: 'ai-chat', output: 'text',
    tags: ['营销文案', '创意写作', 'Gemini'], prompt: '请为一款便携保温杯起草三条中文社交媒体文案。目标受众是通勤人群，重点是轻便、保温和易清洗，语气自然简洁，每条不超过80字，不编造性能数据。' },
];

/** Deterministic IDs + insert-only seeding preserve later administrator edits and unpublishing. */
export function buildStarterTemplates(models: CatalogModel[]) {
  const skipped: string[] = [];
  const templates = recipes.flatMap(recipe => {
    const model = models.find(item => !item.disabled && item.model_id === recipe.model && item.model_type === recipe.feature && item.provider === recipe.provider);
    if (!model) { skipped.push(`${recipe.name}: model unavailable`); return []; }
    const textField = recipe.output === 'audio' ? 'text' : 'prompt';
    const sample = { [textField]: recipe.prompt, ...recipe.parameters,
      ...(recipe.mediaField ? { [recipe.mediaField]: 'https://example.com/your-image.png' } : {}) };
    const validation = validateParams(sample, model.params, model.params_rules);
    if (!validation.valid) { skipped.push(`${recipe.name}: ${validation.errors.map(error => `${error.field} ${error.message}`).join(', ')}`); return []; }
    const inputSchema = { [textField]: { type: 'string', required: true, default: recipe.prompt },
      ...(recipe.mediaField ? { [recipe.mediaField]: { type: 'image', required: true } } : {}) };
    const instructions = [
      '1. 点击「复制并编辑工作流」，创建自己的副本。',
      recipe.mediaField ? `2. 打开模型节点的参数面板，为 ${recipe.mediaField} 上传图片或填写可访问的图片 URL，并修改 ${textField}。` : `2. 打开模型节点的参数面板，修改 ${textField}，可先使用模板中的示例文案。`,
      `3. 在「${model.model_name}」节点中按需调整参数，校验工作流后运行。`,
      `4. 在输出节点查看${recipe.output === 'image' ? '图片' : recipe.output === 'video' ? '视频' : recipe.output === 'audio' ? '音频' : '文本'}结果。`,
      '此模板已配置输入、模型和输出连线；尚未附上生成案例，实际效果以运行结果为准。',
    ].join('\n');
    const workflowDefinition: WorkflowTemplate['workflowDefinition'] = {
      name: recipe.name, description: recipe.description, inputSchema,
      nodes: [
        { id: 'input', type: 'input', position: { x: 0, y: 120 }, data: { label: recipe.mediaField ? '图片与创作要求' : '创作要求' } },
        { id: 'model', type: recipe.nodeType, position: { x: 400, y: 120 }, data: { label: model.model_name, modelId: model.model_id,
          modelSelection: { configId: String(model._id), configRevision: model.revision || 0, featureType: model.model_type, provider: model.provider },
          parameters: { [textField]: recipe.prompt, ...recipe.parameters } } },
        { id: 'output', type: 'output', position: { x: 800, y: 120 }, data: { label: '生成结果' } },
      ],
      edges: [
        { id: 'input-model', source: { nodeId: 'input', port: 'output' }, target: { nodeId: 'model', port: 'input' } },
        { id: 'model-output', source: { nodeId: 'model', port: 'result' }, target: { nodeId: 'output', port: 'input' } },
      ],
      outputMapping: { [recipe.output]: '$nodes.model.result' }, viewport: { x: 60, y: 80, zoom: 0.8 },
      executionConfig: { timeout: 900, failureStrategy: 'fail-fast', maxParallelism: 1 },
    };
    return [{ _id: new Types.ObjectId(createHash('sha256').update(`model-hub/official-starter/v1/${recipe.key}`).digest('hex').slice(0, 24)),
      name: recipe.name, description: recipe.description, category: recipe.category, scenario: recipe.scenario,
      tags: recipe.tags, source: 'official' as const, authorName: 'Model Hub', isPublic: true, version: 1,
      instructions, examples: [], workflowDefinition }];
  });
  return { templates, skipped };
}
