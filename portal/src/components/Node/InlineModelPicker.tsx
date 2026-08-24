import { useState } from 'react';
import { Spin } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useModels } from '../../hooks/useModels';
import { NodeType } from '../../types/node-types';
import { nodeTypeSupportsModel } from '../../utils/model-type-map';
import { formatModelDisplayName } from '../../utils/model-params.util';
import { ModelConfigItem } from '../../services/model-api';
import AnchoredDropdown from './AnchoredDropdown';

interface Props {
  nodeType: NodeType;
  value?: string;
  onChange: (modelId: string, model?: ModelConfigItem) => void;
}

/** 底部 ✦ 模型选择器（数据来自 model_configs） */
export default function InlineModelPicker({ nodeType, value, onChange }: Props) {
  const { models, loading } = useModels(nodeTypeSupportsModel(nodeType) ? nodeType : undefined);
  const [open, setOpen] = useState(false);

  if (!nodeTypeSupportsModel(nodeType)) return null;

  const selected = models.find((m) => m.model_id === value);
  const displayName = loading ? '加载中...' : formatModelDisplayName(selected || (value ? { model_id: value } : undefined));

  return (
    <AnchoredDropdown
      open={open}
      onClose={() => setOpen(false)}
      minWidth={260}
      anchor={(
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="tapnow-model-btn"
          title={value || undefined}
        >
          <span style={{ opacity: 0.6, fontSize: 11 }}>✦</span>
          <span className="tapnow-model-btn__label">{displayName}</span>
          <DownOutlined style={{ fontSize: 9, opacity: 0.35, marginLeft: 2, flexShrink: 0 }} />
        </button>
      )}
    >
      {loading ? (
        <div style={{ padding: 16, textAlign: 'center' }}><Spin size="small" /></div>
      ) : models.length === 0 ? (
        <div style={{ padding: 12, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>暂无可用模型</div>
      ) : (
        models.map((m) => (
          <button
            key={m.model_id}
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(m.model_id, m); setOpen(false); }}
            className={`tapnow-model-option${value === m.model_id ? ' tapnow-model-option--active' : ''}`}
          >
            <div style={{ fontWeight: 500 }}>{formatModelDisplayName(m)}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{m.model_id}</div>
          </button>
        ))
      )}
    </AnchoredDropdown>
  );
}
