import { useState } from 'react';
import { Alert, Button, Collapse, Modal, Select, Space } from 'antd';
import { Link } from 'react-router-dom';
import ModelParamField from '../Node/ModelParamField';
import { dramaApi, type DramaKind, type DramaModel, type DramaQuote } from '../../services/drama-api';
import { getApiErrorMessage } from '../../store/auth-store';
import { needsWorkflowApiKey } from '../../utils/workflow-billing';
import DramaVoicePicker from './DramaVoicePicker';
import DramaVoiceSettings, { voiceSettingNames } from './DramaVoiceSettings';

export interface GenerationRequest { kind: DramaKind; ids: string[]; label: string }
export default function DramaGenerationModal({ projectId, request, models, preferredConfigId, preferredParameters, budgetRemaining, onClose, beforeQuote, onStarted }: {
  projectId: string; preferredConfigId?: string; budgetRemaining?: number; request: GenerationRequest; models: DramaModel[]; onClose: () => void;
  preferredParameters?: Record<string, unknown>; beforeQuote: (configId?: string, parameters?: Record<string, unknown>) => Promise<unknown>; onStarted: () => Promise<void>;
}) {
  const [configId, setConfigId] = useState<string | undefined>(preferredConfigId || (request.kind === 'voice' ? models.find(m => m.kinds.includes('voice'))?.configId : undefined)), [parameters, setParameters] = useState<Record<string, unknown>>(preferredParameters || {});
  const [quote, setQuote] = useState<DramaQuote>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [keyRequired, setKeyRequired] = useState(false);
  const options = models.filter(m => m.kinds.includes(request.kind)), model = options.find(m => m.configId === configId);
  const openapiVoice = request.kind === 'voice' && model?.provider === 'akool-openapi';
  const quoteNow = async () => {
    setBusy(true); setError(''); setKeyRequired(false);
    try { await beforeQuote(configId, parameters); setQuote(await dramaApi.quote(projectId, request.kind, request.ids, configId, parameters)); }
    catch (e) { setError(getApiErrorMessage(e, '生成前检查失败，请重试')); setKeyRequired(needsWorkflowApiKey(e)); }
    finally { setBusy(false); }
  };
  const overBudget = !!quote && budgetRemaining !== undefined && quote.estimatedCost > budgetRemaining;
  const confirm = async () => {
    if (!quote || overBudget) return; setBusy(true); setError('');
    try { await dramaApi.generate(projectId, quote.id); await onStarted(); onClose(); }
    catch (e) { setError(getApiErrorMessage(e, '提交结果尚未确认。可保留这份报价再次提交，同一请求不会重复制作。')); }
    finally { setBusy(false); }
  };
  return <Modal open title={quote ? '开始前，先确认一下' : request.label} onCancel={busy ? undefined : onClose} maskClosable={!busy} closable={!busy} destroyOnClose footer={quote ? <Space wrap><Button disabled={busy} onClick={() => { setQuote(undefined); setError(''); }}>调整设置</Button><Button type="primary" loading={busy} disabled={overBudget} onClick={() => void confirm()}>确认并开始制作</Button></Space> : <Space><Button disabled={busy} onClick={onClose}>暂不开始</Button><Button type="primary" disabled={!options.length || !!(openapiVoice && !parameters.voice_id)} loading={busy} onClick={() => void quoteNow()}>查看本次消耗</Button></Space>}>
    {overBudget && <Alert type="warning" showIcon message={`本次需要 ${quote!.estimatedCost} 积分，项目剩余 ${budgetRemaining} 积分，无法开始制作。请调整范围或联系管理员核实单价。`} />}
    {error && <Alert role="alert" type="error" message={error} showIcon action={keyRequired ? <Link to={`/settings/api-keys?returnTo=${encodeURIComponent(`/short-dramas/${projectId}`)}`}>去配置生成凭证</Link> : undefined} />}
    {quote ? <div className="drama-studio sd-quote"><h2>这次只制作你选中的内容</h2><p>已有镜头与选片均会保留。</p><dl><div><dt>本次范围</dt><dd>{request.label} · {quote.count} 项</dd></div><div><dt>使用模型</dt><dd>{quote.modelName}{quote.provider ? ` · ${quote.provider}` : ''}</dd></div><div><dt>预估消耗</dt><dd>{quote.estimatedCost.toLocaleString(undefined, { maximumFractionDigits: 6 })} 积分</dd></div><div><dt>有效期至</dt><dd>{new Date(quote.expiresAt).toLocaleTimeString()}</dd></div></dl>{quote.warnings.map(w => <p key={w} className="sd-note">{w}</p>)}</div> : <div className="drama-studio"><p>制作 {request.ids.length} 项，仅新增候选，完成后由你决定选用。{request.kind === 'voice' && ' 配音配置会随作品保存，用于后续镜头；试听使用已有候选，不会额外扣费。'}</p>{!options.length ? <Alert type="info" message="当前没有可用模型。可以先上传自己的素材，或联系管理员配置对应能力。" /> : <><label>制作配置</label><Select style={{ width: '100%' }} aria-label="制作配置" value={configId} onChange={value => { setConfigId(value); setParameters({}); setQuote(undefined); setError(''); }} allowClear placeholder="系统推荐（按可用能力匹配）" showSearch optionFilterProp="label" options={options.map(m => ({ value: m.configId, label: [m.name, ({ textToImage: '文生图', imageToImage: '图生图', textToVideo: '文生视频', imageToVideo: '图生视频', tts: '配音', music: '配乐', textGenerate: '剧本' } as Record<string, string>)[m.type], m.provider].filter(Boolean).join(' · ') }))} />{openapiVoice && <DramaVoicePicker key={configId} configId={configId!} value={parameters.voice_id as string | undefined} onChange={voice_id => { setParameters(prev => ({ ...prev, voice_id })); setQuote(undefined); }} />}{openapiVoice && <DramaVoiceSettings model={model!} parameters={parameters} onChange={(name, value) => { setParameters(prev => ({ ...prev, [name]: value })); setQuote(undefined); }} />}<Collapse ghost items={[{ key: 'advanced', label: '更多设置（可选）', children: model ? model.params.filter(p => !['prompt', 'text', ...(openapiVoice ? ['voice_id', ...voiceSettingNames] : [])].includes(p.name)).map(p => <ModelParamField key={p.name} param={p} value={parameters[p.name] ?? p.default} parameters={parameters} onChange={value => { setQuote(undefined); setParameters(prev => ({ ...prev, [p.name]: value })); }} />) : <p>推荐配置会自动填写默认值。需要调整声音、画质或其他参数时，可先选择一个制作配置。</p> }]} /></>}</div>}
  </Modal>;
}
