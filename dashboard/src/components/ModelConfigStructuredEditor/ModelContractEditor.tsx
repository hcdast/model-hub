import { ContractFormTools } from './ContractFormTools';
import { useEffect, useState } from 'react';
import { Alert, Card, Input, Space, Typography, Collapse } from 'antd';
import { validateModelContract } from '@model-hub/common/utils/model-contract';

const fields = [
  ['params', '完整参数定义（含 items、properties、media）'],
  ['params_rules', '跨字段规则'], ['ui_schema', '字段排序、分组与高级设置'],
  ['output_schema', '输出结构'], ['docs', '文档章节与限制'], ['examples', '示例输入输出'], ['pricing', '计费方式与档位选择'],
] as const;
function JsonField({ name, label, value, onChange }: { name: string; label: string; value: unknown; onChange: (v: unknown) => void }) {
  const serialized = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(serialized); }, [serialized]);
  return <div><Typography.Text>{label} <code>{name}</code></Typography.Text>
    <Input.TextArea aria-label={name} rows={5} value={draft} onChange={e => {
      const text = e.target.value; setDraft(text);
      try { onChange(text.trim() ? JSON.parse(text) : ['params_rules', 'examples'].includes(name) ? [] : name === 'output_schema' ? null : {}); setError(''); }
      catch { setError('JSON 格式错误；保存将被拒绝'); onChange(text); }
    }} />{error && <Alert type="error" message={error} />}</div>;
}
export function ModelContractEditor({ value, onChange }: { value: Record<string, any>; onChange: (patch: Record<string, any>) => void }) {
  let errors: string[];
  try { errors = validateModelContract(value); } catch { errors = ['契约结构无效，请检查 JSON']; }
  return <Card size="small" title="文档与在线测试契约">
    <Typography.Paragraph type="secondary">基础表单与此处使用同一份参数。媒体示例：media: {'{ "kind": "image", "referencePrefix": "Image" }'}；规则、文档和输出不会作为模型输入发送。</Typography.Paragraph>
    <Typography.Paragraph type="secondary">pricing.tier_rules 可按输入条件选择价格档位；when 条件全部满足时采用 tier，按顺序匹配第一条，否则按 tier_param 选择。tier 必须存在于价格表。</Typography.Paragraph>
    <Typography.Paragraph type="secondary">LLM 使用 token 计费，价格填每 Token；TTS 使用 count + usage_measure: characters，价格填每字符（每千字符报价除以 1000）。价格统一在上方价格表维护。尚未定价时可保持 disabled=true 和空价格表保存；启用时必须补全有效价格。</Typography.Paragraph>
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {errors.length > 0 && <Alert type="error" message="契约校验未通过" description={errors.join('；')} />}
      <ContractFormTools value={value} onChange={onChange} />
      <Collapse items={[{ key: 'json', label: '高级 JSON（完整契约）', children: <Space direction="vertical" style={{ width: '100%' }}>{fields.map(([name, label]) => <JsonField key={name} name={name} label={label} value={value[name]} onChange={v => onChange({ [name]: v, contract_version: 2 })} />)}</Space> }]} />
    </Space>
  </Card>;
}
