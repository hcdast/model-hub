import { useState } from 'react';
import { Alert, Button, Collapse, Modal, Select, Space } from 'antd';
import ModelParamField from '../Node/ModelParamField';
import { dramaApi, type DramaKind, type DramaModel, type DramaQuote, type DramaPlan, type DramaCandidate } from '../../services/drama-api';
import { referenceIds, systemGenerationField, generationDuration } from '../../../../src/short-drama/drama-experience';
import { visualWarnings, type DramaVisualReport } from '../../../../src/short-drama/drama-visual';
import { getApiErrorMessage } from '../../store/auth-store';
import { needsWorkflowApiKey } from '../../utils/workflow-billing';
import { referenceUsage, shotReferences } from '../../../../src/short-drama/drama-continuity';
import DramaVoicePicker from './DramaVoicePicker';
import DramaVoiceSettings, { voiceSettingNames } from './DramaVoiceSettings';
import { projectEvent } from '../../services/creation-events';

export interface GenerationRequest { kind: DramaKind; ids: string[]; label: string }
export default function DramaGenerationModal({ projectId, plan, visualReport, visualBusy, request, models, preferredConfigId, preferredParameters, budgetRemaining, onClose, beforeQuote, onStarted, candidates=[] }: {
  projectId: string; preferredConfigId?: string; budgetRemaining?: number; request: GenerationRequest; models: DramaModel[]; onClose: () => void;
  plan: DramaPlan;
  candidates?:DramaCandidate[];
  visualReport?: DramaVisualReport; visualBusy?:boolean;
  preferredParameters?: Record<string, unknown>; beforeQuote: (configId?: string, parameters?: Record<string, unknown>) => Promise<unknown>; onStarted: () => Promise<void>;
}) {
  const [configId, setConfigId] = useState<string | undefined>(preferredConfigId || (request.kind === 'voice' ? models.find(m => m.kinds.includes('voice'))?.configId : undefined)), [parameters, setParameters] = useState<Record<string, unknown>>(preferredParameters || {});
  const [quote, setQuote] = useState<DramaQuote>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const options = models.filter(m => m.kinds.includes(request.kind)), model = options.find(m => m.configId === configId);
  const openapiVoice = request.kind === 'voice' && model?.provider === 'akool-openapi';
  const hasReferences=request.ids.every(id=>referenceIds(plan,request.kind,id).length>0);
  const durationDef=model?.params.find(p=>p.name==='duration');
  const referenceWarnings=request.kind==='video' ? visualReport?.entries.filter(e=>e.kind==='image' && request.ids.includes(e.shotId)).flatMap(e=>visualWarnings(plan,e).map(note=>`${plan.shots.find(s=>s.id===e.shotId)?.title}：${note}`)) || [] : [];
  const quoteNow = async () => {
    setBusy(true); setError('');
    try { await beforeQuote(configId, parameters); const result = await dramaApi.quote(projectId, request.kind, request.ids, configId, parameters); setQuote(result); projectEvent('quote_viewed', projectId, result.id); }
    catch (e) { setError(needsWorkflowApiKey(e) ? '生成服务暂时不可用，请稍后重试或联系管理员。已有作品已保留。' : getApiErrorMessage(e, '生成前检查失败，请重试')); }
    finally { setBusy(false); }
  };
  const overBudget = !!quote && budgetRemaining !== undefined && quote.estimatedCost > budgetRemaining;
  const confirm = async () => {
    if (!quote || overBudget) return; setBusy(true); setError('');
    try { await dramaApi.generate(projectId, quote.id); await onStarted(); onClose(); }
    catch (e) { setError(getApiErrorMessage(e, '提交结果尚未确认。可保留这份报价再次提交，同一请求不会重复制作。')); }
    finally { setBusy(false); }
  };
  return <Modal open title={quote ? '开始前，先确认一下' : request.label} onCancel={busy ? undefined : onClose} maskClosable={!busy} closable={!busy} destroyOnClose footer={quote ? <Space wrap><Button disabled={busy} onClick={() => { setQuote(undefined); setError(''); }}>调整设置</Button><Button type="primary" loading={busy} disabled={overBudget || request.kind==='video' && visualBusy} onClick={() => void confirm()}>确认并开始制作</Button></Space> : <Space><Button disabled={busy} onClick={onClose}>暂不开始</Button><Button type="primary" disabled={!options.length || request.kind==='video' && visualBusy || !!(openapiVoice && !parameters.voice_id)} loading={busy} onClick={() => void quoteNow()}>查看本次消耗</Button></Space>}>
    {visualBusy && request.kind==='video' && <p aria-live="polite">正在检查所选参考图的实际画幅…</p>}
    <p className="sd-note">本次仅制作 {request.ids.length} 项。查看报价不会开始生成；确认后才提交。后续阶段的制作与重做不包含在本次报价中。确认后将校验账号余额和项目预算。</p>
    <details><summary>查看本次制作范围 · {request.ids.length} 项</summary><ol className="sd-generation-scope">{request.ids.map(id=><li key={id}>{plan.shots.find(s=>s.id===id)?.title || [...plan.characters,...plan.scenes].find(r=>r.id===id)?.name || plan.title}</li>)}</ol></details>
    {quote && budgetRemaining!==undefined && <p aria-label="本批预算影响">项目剩余预算 {budgetRemaining} 积分 · 本批预估 {quote.estimatedCost} 积分 · 按预估预留后剩余 {Math.max(0,Math.round((budgetRemaining-quote.estimatedCost)*1e6)/1e6)} 积分。最终按实际用量结算，可能高于或低于预估。</p>}
    {['image','video'].includes(request.kind) && <section aria-label="本批参考图使用情况"><strong>本批参考图使用情况</strong><p className="sd-note">角色与场景按关联顺序传入；单图模型只接收一张，多图模型受配置数量限制。参考图不能保证人物完全一致，请预览后选用。</p>{request.ids.map(id=>{
      const shot=plan.shots.find(s=>s.id===id),actual=quote?.items?.find(item=>item.targetId===id);
      const preview=model ? referenceUsage(shotReferences(plan,request.kind,id),model.params) : undefined;
      const used=actual?.references ?? preview?.used,omitted=actual?.omittedReferences ?? preview?.omitted;
      return <div key={id}><p><strong>{shot?.title || id}</strong>：{used ? used.length?`使用 ${used.length} 张（${used.map(r=>r.name).join('、')}）`:actual ? actual.manualReferenceCount ? '使用 '+actual.manualReferenceCount+' 张手动输入参考图（非角色/场景绑定）' : '未传参考图，仅使用文字描述' : '未使用关联参考图，手动输入以报价结果为准':'推荐模型将在报价后显示实际参考图'}</p>{used && <div className="sd-reference-thumbnails">{used.map(ref=>{const media=candidates.find(c=>c.id===ref.candidateId && c.kind===ref.kind && c.targetId===ref.targetId);return media?.url?<figure key={ref.candidateId}><img src={media.url} alt={ref.name+'参考图'}/><figcaption>{ref.name}</figcaption></figure>:null;})}</div>}{!!omitted?.length && <Alert type="warning" message={`未传入：${omitted.map(r=>r.name).join('、')}`} description="当前模型没有参考图输入或数量不足。若这些参考图必须生效，请切换支持更多参考图的模型后重新报价。"/>}</div>;
    })}</section>}
    {referenceWarnings.length>0 && <Alert type="warning" message="参考图画幅与成片要求不同，或原生尺寸较低" description={<><p>图生视频可能跟随参考图画幅。请先检查或更换参考图；继续制作时，成片会按当前留边/裁切设置适配。</p>{referenceWarnings.map((note,i)=><p key={i}>{note}</p>)}</>}/>}
    {overBudget && <Alert type="warning" showIcon message={`本次需要 ${quote!.estimatedCost} 积分，项目剩余预算 ${budgetRemaining} 积分，无法开始制作。请调整范围或联系管理员核实单价。`} />}
    {error && <Alert role="alert" type="error" message={error} showIcon />}
    {quote ? <div className="drama-studio sd-quote"><h2>这次只制作你选中的内容</h2><p>已有镜头与选片均会保留。</p><dl><div><dt>本次范围</dt><dd>{request.label} · {quote.count} 项</dd></div><div><dt>使用模型</dt><dd>{quote.modelName}{quote.provider ? ` · ${quote.provider}` : ''}</dd></div><div><dt>预估消耗</dt><dd>{quote.estimatedCost.toLocaleString(undefined, { maximumFractionDigits: 6 })} 积分</dd></div><div><dt>有效期至</dt><dd>{new Date(quote.expiresAt).toLocaleTimeString()}</dd></div></dl>{request.kind === 'video' && quote.items?.map(item => <p key={item.targetId}>{item.title}：剪辑 {item.requestedDuration} 秒 · {item.duration ? `模型生成 ${item.duration} 秒${item.duration < (item.requestedDuration || 0) ? '（源片不足时延长末帧）' : item.duration > (item.requestedDuration || 0) ? '（成片按镜头时长裁剪）' : ''}` : '模型时长未声明，请检查返回视频'}</p>)}{quote.warnings.map(w => <p key={w} className="sd-note">{w}</p>)}</div> : <div className="drama-studio"><p>制作 {request.ids.length} 项，仅新增候选，完成后由你决定选用。{request.kind === 'voice' && ' 配音配置会随作品保存，用于后续镜头；试听使用已有候选，不会额外扣费。'}</p>{!options.length ? <Alert type="info" message="当前没有可用模型。可以先上传自己的素材，或联系管理员配置对应能力。" /> : <><label>制作配置</label><Select style={{ width: '100%' }} aria-label="制作配置" value={configId} onChange={value => { setConfigId(value); setParameters({}); setQuote(undefined); setError(''); }} allowClear placeholder="系统推荐（按可用能力匹配）" showSearch optionFilterProp="label" options={options.map(m => ({ value: m.configId, disabled: ['character','scene','image','video'].includes(request.kind) && !!m.params.find(p=>p.name==='aspect_ratio')?.enum?.length && !m.params.find(p=>p.name==='aspect_ratio')?.enum?.includes(plan.frame?.ratio || '9:16'), label: [m.name, ({ textToImage: '文生图', imageToImage: '图生图', textToVideo: '文生视频', imageToVideo: '图生视频', tts: '配音', music: '配乐', textGenerate: '剧本' } as Record<string, string>)[m.type], m.provider].filter(Boolean).join(' · ') }))} />{['character','scene','image','video'].includes(request.kind) && <Alert type="info" message={`作品画幅 ${plan.frame?.ratio || '9:16'} · 图片参考和画幅由工作台自动填写`} description={model && !model.params.some(p=>['aspect_ratio','width'].includes(p.name)) ? '此模型未声明独立画幅控制，生成后请检查实际尺寸；图生视频通常跟随所选图片。' : '尺寸能力会在报价时检查；不支持当前画幅时请切换模型。'} />}{request.kind === 'video' && <div aria-label="本次镜头时长">{request.ids.map(id=>{const shot=plan.shots.find(s=>s.id===id);return <p key={id}>{shot?.title} · 剪辑 {shot?.duration} 秒 · {durationDef ? `预计生成 ${generationDuration(shot?.duration || 5,durationDef)} 秒` : '模型时长以报价和返回结果为准'}</p>})}<p className="sd-note">逐镜头时长自动填写；实际参数和扣费范围以确认页为准。</p></div>}{openapiVoice && <DramaVoicePicker key={configId} configId={configId!} value={parameters.voice_id as string | undefined} onChange={voice_id => { setParameters(prev => ({ ...prev, voice_id })); setQuote(undefined); }} />}{openapiVoice && <DramaVoiceSettings model={model!} parameters={parameters} onChange={(name, value) => { setParameters(prev => ({ ...prev, [name]: value })); setQuote(undefined); }} />}<Collapse ghost items={[{ key: 'advanced', label: '更多设置（可选）', children: model ? model.params.filter(p => !p.hide && !systemGenerationField(p.name,request.kind,hasReferences,p.media?.kind) && !(openapiVoice && ['voice_id',...voiceSettingNames].includes(p.name))).map(p => <ModelParamField key={p.name} param={p} value={parameters[p.name] ?? p.default} parameters={parameters} onChange={value => { setQuote(undefined); setParameters(prev => ({ ...prev, [p.name]: value })); }} />) : <p>推荐配置会自动填写默认值。需要调整声音、画质或其他参数时，可先选择一个制作配置。</p> }]} /></>}</div>}
  </Modal>;
}
