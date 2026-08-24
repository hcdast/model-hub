import { Select, Spin } from 'antd';
import { useModels } from '../../hooks/useModels';
import { NodeType } from '../../types/node-types';
import { nodeTypeSupportsModel } from '../../utils/model-type-map';

interface Props {
  nodeType: NodeType;
  value?: string;
  onChange: (modelId: string) => void;
  placeholder?: string;
}

export default function ModelSelect({ nodeType, value, onChange, placeholder = '选择模型' }: Props) {
  const { models, loading } = useModels(nodeTypeSupportsModel(nodeType) ? nodeType : undefined);

  if (!nodeTypeSupportsModel(nodeType)) return null;

  return (
    <Select
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      loading={loading}
      showSearch
      optionFilterProp="label"
      notFoundContent={loading ? <Spin size="small" /> : '暂无可用模型'}
      style={{ width: '100%' }}
      options={models.map((m) => ({
        label: m.model_id,
        value: m.model_id,
      }))}
    />
  );
}
