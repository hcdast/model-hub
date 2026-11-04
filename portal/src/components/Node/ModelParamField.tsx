import { useEffect, useState } from 'react';
import { Input, InputNumber, Radio, Select, Slider, Switch } from 'antd';
import { ParamDocItem } from '../../types/model-params';
import { resolveEnumOptions, validateParam } from '../../utils/model-params.util';
import MediaParamField from './MediaParamField';

interface Props {
  param: ParamDocItem;
  value: unknown;
  parameters: Record<string, unknown>;
  onChange: (value: unknown) => void;
}

export default function ModelParamField({ param, value, parameters, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const [parseError, setParseError] = useState<string>();
  useEffect(() => { setDraft(value === undefined ? '' : typeof value === 'string' && (param.type === 'array' || param.type === 'object') ? value : JSON.stringify(value, null, 2)); setParseError(undefined); }, [value, param.name]);
  const options = resolveEnumOptions(param, parameters);
  const error = parseError || validateParam(param, value, parameters);
  const enumField = !!param.enum?.length || !!param.enumDependsOn;
  const disabledReason = param.hide ? '此字段由服务端管理' : enumField && !options.length ? `请先配置 ${param.enumDependsOn?.param ?? '依赖参数'}` : undefined;
  let control;
  if (param.media) {
    control = <MediaParamField param={param} value={value} onChange={onChange} />;
  } else if (enumField && param.ui_type === 'radio') {
    control = <Radio.Group value={value} options={options.map(v => ({ label: String(v), value: v as string | number | boolean }))} onChange={e => onChange(e.target.value)} />;
  } else if (enumField) {
    control = <Select aria-label={param.label || param.name} style={{ width: '100%' }} value={value === undefined ? undefined : JSON.stringify(value)} allowClear={!param.required} disabled={!!disabledReason} placeholder="请选择" options={options.map((option) => ({ label: String(option), value: JSON.stringify(option) }))} onChange={(next) => onChange(next === undefined ? undefined : JSON.parse(next))} />;
  } else if (param.type === 'number' || param.type === 'integer') {
    control = <><InputNumber aria-label={param.label || param.name} style={{ width: '100%' }} value={typeof value === 'number' ? value : null} min={param.min} max={param.max} step={param.multipleOf || 1} precision={param.type === 'integer' ? 0 : undefined} disabled={!!disabledReason} onChange={(next) => onChange(next ?? undefined)} />{param.ui_type === 'slider' && <Slider min={param.min} max={param.max} step={param.multipleOf || 1} value={typeof value === 'number' ? value : param.min} onChange={onChange} />}</>;
  } else if (param.type === 'boolean') {
    control = <Switch aria-label={param.label || param.name} checked={value === true} disabled={!!disabledReason} onChange={onChange} />;
  } else if (param.type === 'object' || param.type === 'array') {
    control = <Input.TextArea aria-label={param.label || param.name} value={draft} rows={4} disabled={!!disabledReason} onChange={(event) => {
      setDraft(event.target.value);
      try {
        const next: unknown = event.target.value.trim() ? JSON.parse(event.target.value) : undefined;
        const invalid = validateParam(param, next, parameters);
        if (invalid) { setParseError(invalid); onChange(next); return; }
        setParseError(undefined); onChange(next);
      } catch { setParseError('请输入有效 JSON'); onChange(event.target.value); }
    }} />;
  } else if (param.ui_type === 'password') {
    control = <Input.Password aria-label={param.label || param.name} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)} />;
  } else if (param.ui_type === 'input') {
    control = <Input aria-label={param.label || param.name} value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)} />;
  } else {
    control = <Input.TextArea aria-label={param.label || param.name} value={typeof value === 'string' ? value : ''} autoSize={{ minRows: 1, maxRows: 8 }} disabled={!!disabledReason} onChange={(event) => onChange(event.target.value)} />;
  }
  return <div className="nodrag nowheel" style={{ minWidth: 170, marginBottom: 12 }}>
    <label style={{ display: 'block', marginBottom: 5 }}>{param.label || param.name}{param.required ? ' *' : ''}</label>
    {control}
    {param.description && <div style={{ opacity: 0.65, fontSize: 12 }}>{param.description}</div>}
    {disabledReason && <div role="note">{disabledReason}</div>}
    {error && <div role="alert" style={{ color: '#ff7875', fontSize: 12 }}>{error}</div>}
  </div>;
}
