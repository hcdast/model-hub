import { useState } from 'react';
import { Spin } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useModels } from '../../hooks/useModels';
import { NodeType } from '../../types/node-types';
import { nodeTypeSupportsModel } from '../../utils/model-type-map';
import { formatModelDisplayName } from '../../utils/model-params.util';
import { ModelConfigItem } from '../../services/model-api';
import AnchoredDropdown from './AnchoredDropdown';
import type { ModelSelection } from '../../../../src/common/interfaces/model-contract.interface';

interface Props {
  nodeType: NodeType;
  value?: string;
  selection?: ModelSelection;
  onChange: (modelId: string, model?: ModelConfigItem) => void | Promise<void>;
}

/** 底部 ✦ 模型选择器（数据来自 model_configs） */
export default function InlineModelPicker({ nodeType, value, selection, onChange }: Props) {
  const { models, loading, error, retry } = useModels(nodeTypeSupportsModel(nodeType) ? nodeType : undefined);
  const [open, setOpen] = useState(false);
  const [selectionError, setSelectionError] = useState<string>();
  const [selecting, setSelecting] = useState(false);

  if (!nodeTypeSupportsModel(nodeType)) return null;

  const isSelected = (m: ModelConfigItem) => m.model_id === value && (selection?.configId ? m._id === selection.configId : (!selection?.provider || m.provider === selection.provider) && (!selection?.featureType || m.model_type === selection.featureType));
  const selected = models.find(isSelected);
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
      {(error || selectionError) && <div role="alert" style={{ padding: 12, color: '#ff7875' }}>{error || selectionError}{error && <button type="button" onClick={retry}>重试</button>}</div>}
      {loading ? (
        <div style={{ padding: 16, textAlign: 'center' }}><Spin size="small" /></div>
      ) : models.length === 0 ? (
        <div style={{ padding: 12, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>暂无可用模型</div>
      ) : (
        models.map((m) => (
          <button
            key={m._id || JSON.stringify([m.model_id, m.model_type, m.provider])}
            type="button"
            disabled={m.disabled || selecting}
            title={m.disabled ? '该模型已停用' : undefined}
            onClick={async (e) => {
              e.stopPropagation(); setSelectionError(undefined); setSelecting(true);
              try { await onChange(m.model_id, m); setOpen(false); }
              catch (failure) { setSelectionError(failure instanceof Error ? failure.message : '模型加载失败，请重新选择重试'); }
              finally { setSelecting(false); }
            }}
            className={`tapnow-model-option${isSelected(m) ? ' tapnow-model-option--active' : ''}`}
          >
            <div style={{ fontWeight: 500 }}>{formatModelDisplayName(m)}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{m.provider} · {m.model_type} · {m.model_id}</div>
          </button>
        ))
      )}
    </AnchoredDropdown>
  );
}
