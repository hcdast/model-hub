import { ParamDefinition, ParamDocItem } from '../types/model-params';
import { SKIP_FOOTER_PARAMS, PARAM_DISPLAY_PRIORITY } from '../types/model-params';

/** 从 params 定义提取默认值 */
export function extractDefaultParams(
  params?: Record<string, ParamDefinition>,
): Record<string, unknown> {
  if (!params) return {};
  const result: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(params)) {
    if (def.hide || def.default === undefined) continue;
    result[key] = def.default;
  }
  return result;
}

/** 解析 enum 可选项（支持 enumDependsOn） */
export function resolveEnumOptions(
  param: ParamDocItem,
  currentParams: Record<string, unknown>,
): (string | number | boolean)[] {
  if (param.enumDependsOn) {
    const depValue = String(currentParams[param.enumDependsOn.param] ?? '');
    const mapped = param.enumDependsOn.map[depValue];
    return mapped ?? [];
  }
  return param.enum ?? [];
}

/** 是否适合在底部工具栏展示 */
export function isFooterParam(param: ParamDocItem): boolean {
  if (param.hide || SKIP_FOOTER_PARAMS.has(param.name)) return false;
  return ['number', 'integer', 'boolean'].includes(param.type) || !!param.enum?.length || !!param.enumDependsOn;
}

/** 获取底部展示参数（最多 limit 个） */
export function getFooterParams(params: ParamDocItem[], limit = 3): ParamDocItem[] {
  const candidates = params.filter(isFooterParam);
  candidates.sort((a, b) => {
    const ai = PARAM_DISPLAY_PRIORITY.indexOf(a.name);
    const bi = PARAM_DISPLAY_PRIORITY.indexOf(b.name);
    const ap = ai === -1 ? 999 : ai;
    const bp = bi === -1 ? 999 : bi;
    return ap - bp;
  });
  return candidates.slice(0, limit);
}

/** 参数展示标签 */
export function formatParamLabel(param: ParamDocItem, value: unknown): string {
  const label = param.label || humanizeParamName(param.name);
  if (value === undefined || value === null || value === '') {
    return label;
  }
  return `${label} · ${value}`;
}

function humanizeParamName(name: string): string {
  const map: Record<string, string> = {
    aspect_ratio: '比例',
    resolution: '分辨率',
    size: '尺寸',
    duration: '时长',
    fps: '帧率',
    style: '风格',
    quality: '质量',
    mode: '模式',
    swap_type: '换脸',
    seed: '种子',
  };
  return map[name] ?? name.replace(/_/g, ' ');
}

/** 格式化模型展示名 */
export function formatModelDisplayName(model?: { model_name?: string; model_id?: string }): string {
  if (model?.model_name) return model.model_name;
  if (!model?.model_id) return '选择模型';
  const last = model.model_id.split('/').pop() || model.model_id;
  return last.replace(/-/g, ' ');
}

export function validateParam(param: ParamDocItem, value: unknown, parameters: Record<string, unknown>): string | undefined {
  if (value === undefined || value === null || value === '') return param.required ? '此参数为必填项' : undefined;
  if (param.type === 'array' ? !Array.isArray(value) : param.type === 'object' ? typeof value !== 'object' || Array.isArray(value) : param.type === 'integer' ? typeof value !== 'number' || !Number.isInteger(value) : typeof value !== param.type) return `需要 ${param.type} 类型`;
  if (typeof value === 'number' && (!Number.isFinite(value) || (param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max))) return `数值范围：${param.min ?? '不限'} 至 ${param.max ?? '不限'}`;
  if ((param.enum?.length || param.enumDependsOn) && !resolveEnumOptions(param, parameters).includes(value as string | number | boolean)) return '不在当前可用选项中';
  return undefined;
}

export function compatibleParams(previous: Record<string, unknown>, definitions: Record<string, ParamDefinition>): Record<string, unknown> {
  const defaults = extractDefaultParams(definitions);
  const next: Record<string, unknown> = {};
  const visible = Object.keys(definitions).filter(name => !definitions[name].hide);
  const visited = new Set<string>();
  const path: string[] = [];
  const active = new Map<string, number>();
  const cyclic = new Set<string>();
  const ordered: string[] = [];
  const visit = (name: string) => {
    const start = active.get(name);
    if (start !== undefined) {
      for (const member of path.slice(start)) cyclic.add(member);
      return;
    }
    if (visited.has(name)) return;
    active.set(name, path.length); path.push(name);
    const dependency = definitions[name].enumDependsOn?.param;
    if (dependency && Object.prototype.hasOwnProperty.call(definitions, dependency) && !definitions[dependency].hide) visit(dependency);
    path.pop(); active.delete(name); visited.add(name); ordered.push(name);
  };
  for (const name of visible) visit(name);

  // Cycles may only retain mutually valid defaults, never previous model values.
  for (const name of cyclic) if (defaults[name] !== undefined) next[name] = defaults[name];
  for (;;) {
    const invalid = [...cyclic].filter(name => Object.prototype.hasOwnProperty.call(next, name) && validateParam({ ...definitions[name], name }, next[name], next));
    if (!invalid.length) break;
    for (const name of invalid) delete next[name];
  }
  // Dependencies precede their consumers regardless of definition insertion order.
  for (const name of ordered) {
    if (cyclic.has(name)) continue;
    const param = { ...definitions[name], name };
    const oldValue = Object.prototype.hasOwnProperty.call(previous, name) ? previous[name] : undefined;
    if (oldValue !== undefined && !validateParam(param, oldValue, next)) next[name] = oldValue;
    else if (defaults[name] !== undefined && !validateParam(param, defaults[name], next)) next[name] = defaults[name];
  }
  return next;
}

export function findMediaParams(params: Record<string, ParamDefinition>, kind: 'image' | 'video' | 'audio' | 'text'): string[] {
  const names: Record<typeof kind, string[]> = {
    image: ['image', 'images', 'image_url', 'image_urls', 'input_image', 'reference_image', 'referenceImage', 'inputImage'],
    video: ['video', 'video_url', 'input_video', 'reference_video'],
    audio: ['audio', 'audio_url', 'input_audio', 'reference_audio'],
    text: ['prompt', 'text', 'input_text'],
  };
  return Object.entries(params).filter(([name, definition]) => !definition.hide && (names[kind].includes(name) || definition.ui_type === kind || definition.ui_type === `${kind}_upload`)).map(([name]) => name);
}
