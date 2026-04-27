import {
  ParamDefinitions,
  ParamDefinition,
  ParamDocItem,
  ModelParamDoc,
} from '../interfaces/param-definition.interface';
import { ModelConfig } from '../../database/schemas/model-config.schema';

/**
 * 根据 ModelConfig 生成结构化参数文档（JSON 格式）。
 * 排除 hide === true 的参数。
 */
export function generateParamDoc(modelConfig: ModelConfig): ModelParamDoc {
  const definitions = (modelConfig.params ?? {}) as ParamDefinitions;
  const params: ParamDocItem[] = [];

  for (const [name, def] of Object.entries(definitions)) {
    if (def.hide === true) continue;

    const item: ParamDocItem = {
      name,
      type: def.type,
      required: def.required,
    };

    if (def.default !== undefined) item.default = def.default;
    if (def.description !== undefined) item.description = def.description;
    if (def.enum !== undefined) item.enum = def.enum;
    if (def.min !== undefined) item.min = def.min;
    if (def.max !== undefined) item.max = def.max;
    if (def.configs !== undefined) item.configs = def.configs;

    params.push(item);
  }

  return {
    model_name: modelConfig.model_name,
    model_type: modelConfig.model_type,
    provider: modelConfig.provider,
    label: modelConfig.label,
    params,
  };
}

/**
 * 生成单个模型的 Markdown 参数表格（用于 Swagger description）。
 * 排除 hide === true 的参数。
 */
export function generateMarkdownTable(modelConfig: ModelConfig): string {
  const definitions = (modelConfig.params ?? {}) as ParamDefinitions;
  const visibleEntries = Object.entries(definitions).filter(
    ([, def]) => def.hide !== true,
  );

  if (visibleEntries.length === 0) return '';

  const header = `### ${modelConfig.model_name} (${modelConfig.label})`;
  const tableHeader =
    '| 参数名 | 类型 | 必填 | 默认值 | 可选值 | 说明 |';
  const separator =
    '|--------|------|------|--------|--------|------|';

  const rows = visibleEntries.map(([name, def]) => {
    const required = def.required ? '是' : '否';
    const defaultVal =
      def.default !== undefined ? String(def.default) : '-';
    const enumVal =
      def.enum && def.enum.length > 0 ? def.enum.join(', ') : '-';
    const description = formatDescription(def);
    return `| ${name} | ${def.type} | ${required} | ${defaultVal} | ${enumVal} | ${description} |`;
  });

  return [header, tableHeader, separator, ...rows].join('\n');
}

/** 格式化参数描述，包含范围信息 */
function formatDescription(def: ParamDefinition): string {
  const parts: string[] = [];

  if (def.description) parts.push(def.description);

  if (def.min !== undefined && def.max !== undefined) {
    parts.push(`范围: ${def.min}~${def.max}`);
  } else if (def.min !== undefined) {
    parts.push(`最小值: ${def.min}`);
  } else if (def.max !== undefined) {
    parts.push(`最大值: ${def.max}`);
  }

  return parts.length > 0 ? parts.join(', ') : '-';
}

/**
 * 批量生成所有模型的 Swagger 描述文本。
 * 仅包含有 params 定义的模型。
 */
export function generateSwaggerDescription(
  modelConfigs: ModelConfig[],
): string {
  const sections = modelConfigs
    .filter(
      (cfg) => cfg.params && Object.keys(cfg.params).length > 0,
    )
    .map((cfg) => generateMarkdownTable(cfg))
    .filter((md) => md.length > 0);

  if (sections.length === 0) return '';

  return ['## 模型参数说明\n', ...sections].join('\n\n');
}
