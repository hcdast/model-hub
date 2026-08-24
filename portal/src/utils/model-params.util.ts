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
    if (mapped?.length) return mapped;
  }
  return param.enum ?? [];
}

/** 是否适合在底部工具栏展示 */
export function isFooterParam(param: ParamDocItem): boolean {
  if (SKIP_FOOTER_PARAMS.has(param.name)) return false;
  const hasEnum = (param.enum?.length ?? 0) > 0 || !!param.enumDependsOn;
  const isNumeric = param.type === 'number' && (param.min !== undefined || param.max !== undefined);
  return hasEnum || isNumeric || param.ui_type === 'select' || param.ui_type === 'slider';
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
