import { useState } from 'react';
import { useModelParams } from '../../hooks/useModelParams';
import { formatParamLabel, getFooterParams } from '../../utils/model-params.util';
import { FooterChip } from './ExpandedNodeShell';
import AnchoredDropdown from './AnchoredDropdown';
import ModelParamField from './ModelParamField';

interface Props {
  modelId?: string;
  selection?: import('../../../../src/common/interfaces/model-contract.interface').ModelSelection;
  parameters?: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
  maxChips?: number;
}

export default function ModelParamChips({ modelId, selection, parameters = {}, onParamChange, maxChips = 3 }: Props) {
  const { params, loading, error, retry } = useModelParams(modelId, selection);
  const [openParam, setOpenParam] = useState<string | null>(null);
  if (!modelId) return null;
  if (loading) return <span>参数加载中…</span>;
  if (error) return <button type="button" title={error} onClick={retry}>参数加载失败，重试</button>;
  return <>{getFooterParams(params, maxChips).map((param) => <AnchoredDropdown key={`${modelId}:${param.name}`} open={openParam === param.name} onClose={() => setOpenParam(null)} minWidth={230} anchor={<FooterChip label={formatParamLabel(param, parameters[param.name])} onClick={(event) => { event.stopPropagation(); setOpenParam(openParam === param.name ? null : param.name); }} />}>
    <div style={{ padding: 12 }} onClick={(event) => event.stopPropagation()}><ModelParamField param={param} value={parameters[param.name]} parameters={parameters} onChange={(value) => onParamChange(param.name, value)} /></div>
  </AnchoredDropdown>)}</>;
}
