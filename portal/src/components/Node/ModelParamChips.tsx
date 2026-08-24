import { useState } from 'react';
import { ParamDocItem } from '../../types/model-params';
import { useModelParams } from '../../hooks/useModelParams';
import {
  formatParamLabel,
  getFooterParams,
  resolveEnumOptions,
} from '../../utils/model-params.util';
import { FooterChip } from './ExpandedNodeShell';
import AnchoredDropdown from './AnchoredDropdown';

interface Props {
  modelId?: string;
  parameters?: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
  maxChips?: number;
}

/** 底部动态参数芯片（来自 model_configs.params） */
export default function ModelParamChips({ modelId, parameters = {}, onParamChange, maxChips = 3 }: Props) {
  const { params, loading } = useModelParams(modelId);
  const [openParam, setOpenParam] = useState<string | null>(null);

  if (!modelId) return null;
  if (loading) {
    return <FooterChip label="参数加载中..." />;
  }

  const footerParams = getFooterParams(params, maxChips);
  if (footerParams.length === 0) return null;

  return (
    <>
      {footerParams.map((param) => (
        <ParamChip
          key={param.name}
          param={param}
          value={parameters[param.name]}
          parameters={parameters}
          open={openParam === param.name}
          onToggle={() => setOpenParam(openParam === param.name ? null : param.name)}
          onClose={() => setOpenParam(null)}
          onChange={(v) => onParamChange(param.name, v)}
        />
      ))}
    </>
  );
}

function ParamChip({
  param,
  value,
  parameters,
  open,
  onToggle,
  onClose,
  onChange,
}: {
  param: ParamDocItem;
  value: unknown;
  parameters: Record<string, unknown>;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (v: unknown) => void;
}) {
  const options = resolveEnumOptions(param, parameters);
  const displayValue = value ?? param.default;
  const label = formatParamLabel(param, displayValue);

  if (options.length === 0) {
    return <FooterChip label={label} />;
  }

  return (
    <AnchoredDropdown
      open={open}
      onClose={onClose}
      minWidth={140}
      anchor={(
        <FooterChip
          label={label}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        />
      )}
    >
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange(opt); onClose(); }}
          className={`tapnow-model-option${displayValue === opt ? ' tapnow-model-option--active' : ''}`}
        >
          {String(opt)}
        </button>
      ))}
    </AnchoredDropdown>
  );
}
