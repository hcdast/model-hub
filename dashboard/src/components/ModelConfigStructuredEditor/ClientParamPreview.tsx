import { Empty, Typography } from 'antd';
import type {
  ParamDefinition,
  ParamDefinitions,
} from '@model-hub/common/interfaces/param-definition.interface';
import { ParamForm } from '../ParamForm';
import { filterHiddenParams } from '../ParamForm/utils';

function coerceDefinitions(raw: unknown): ParamDefinitions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ParamDefinitions = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const d = v as Record<string, unknown>;
    if (typeof d.type !== 'string' || typeof d.required !== 'boolean') continue;
    out[k] = v as ParamDefinition;
  }
  return out;
}

export interface ClientParamPreviewProps {
  /** 来自配置的 params（可为不完整对象，将跳过非法项） */
  definitions: unknown;
  /** 为 true 时不包外层 Card，供右侧预览栏嵌入使用 */
  embedded?: boolean;
}

/**
 * 根据 params 定义只读预览客户端表单样式（与 ParamForm 渲染一致）
 */
export function ClientParamPreview({
  definitions,
  embedded = false,
}: ClientParamPreviewProps) {
  const coerced = coerceDefinitions(definitions);
  const visible = filterHiddenParams(coerced);

  const inner =
    Object.keys(visible).length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 params 定义" />
    ) : (
      <ParamForm definitions={visible} disabled />
    );

  if (embedded) {
    return <div className="model-config-client-preview">{inner}</div>;
  }

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        根据当前 params 定义生成的表单预览（只读），便于核对客户端展示效果。
      </Typography.Paragraph>
      {inner}
    </div>
  );
}
