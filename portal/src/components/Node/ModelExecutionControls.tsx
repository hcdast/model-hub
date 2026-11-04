import { useState } from 'react';
import { useModelParams } from '../../hooks/useModelParams';
import AnchoredDropdown from './AnchoredDropdown';
import ModelParamField from './ModelParamField';

interface Props {
  modelId?: string;
  selection?: import('../../../../src/common/interfaces/model-contract.interface').ModelSelection;
  parameters?: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
}

export default function ModelExecutionControls({ modelId, selection, parameters = {}, onParamChange }: Props) {
  const { params, loading, error, retry } = useModelParams(modelId, selection);
  const [opened, setOpened] = useState<string>();
  const groups = [{ label: '速度', keys: ['speed', 'speed_factor', 'speaking_rate'] }, { label: '数量', keys: ['image_quantity', 'img_count', 'num_images', 'batch_count'] }];
  return <>{groups.map((group) => {
    const param = params.find((item) => !item.hide && group.keys.includes(item.name));
    const reason = !modelId ? '请先选择模型' : loading ? '正在加载模型参数' : error || (!param ? `该模型未声明${group.label}参数` : undefined);
    const button = <button type="button" className="nodrag" disabled={!!reason} title={reason} onClick={(event) => { event.stopPropagation(); setOpened(opened === group.label ? undefined : group.label); }}>{group.label}{param && parameters[param.name] !== undefined ? ` · ${String(parameters[param.name])}` : ''}</button>;
    return param && !reason ? <AnchoredDropdown key={group.label} open={opened === group.label} onClose={() => setOpened(undefined)} anchor={button} minWidth={230}><div style={{ padding: 12 }}><ModelParamField param={param} value={parameters[param.name]} parameters={parameters} onChange={(value) => onParamChange(param.name, value)} /></div></AnchoredDropdown> : <span key={group.label} title={reason}>{button}</span>;
  })}{error && <button type="button" onClick={retry}>重试参数</button>}</>;
}
