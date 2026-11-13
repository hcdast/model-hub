import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, InputNumber, Modal, Select, Tag } from 'antd';
import { dramaApi, type DramaProject, type DramaPlan, type DramaKind, type DramaModel } from '../../services/drama-api';
import { failedProduction } from '../../../../src/short-drama/drama-experience';

const kinds: Array<[DramaKind, string]> = [['script', '剧本'], ['character', '角色图'], ['scene', '场景图'], ['image', '分镜画面'], ['video', '镜头视频'], ['voice', '旁白'], ['music', '配乐']];
export default function DramaProductionPanel({ project, models, modelStatus, refreshModels, edit, flush, reload, mutate, retry, run }: {
  project: DramaProject; models: DramaModel[]; edit: (plan: DramaPlan) => void; flush: () => Promise<DramaProject | undefined>;
  reload: () => Promise<void>; run: (action: () => Promise<void>) => void;
  mutate: (action: (saved: DramaProject) => Promise<DramaProject>) => Promise<DramaProject | undefined>;
  retry: (kind: DramaKind, ids: string[], label: string) => void;
  modelStatus: 'loading' | 'ready' | 'error'; refreshModels: () => void;
}) {
  const p = project.plan, budget = project.budget;
  const [limit, setLimit] = useState(budget?.limit ?? 100);
  useEffect(() => { setLimit(budget?.limit ?? 100); }, [budget?.limit]);
  const provider = p.production?.provider || 'akool-maas';
  const missing = kinds.filter(([kind]) => kind!=='music' && !models.some(m => m.provider === (p.production?.providers?.[kind] || provider) && m.kinds.includes(kind)));
  const active = project.candidates.filter(c => ['pending', 'running'].includes(c.status)).length;
  const failures = failedProduction(p, project.candidates);
  const archiveFailures = project.candidates.filter(c => c.archiveStatus === 'failed').length;
  return <section className="sd-production" aria-label="制作方案与预算">
    <div className="sd-actions" aria-live="polite"><Tag>{provider}</Tag><span>项目预算 {budget?.limit ?? 0} 积分 · 已用 {budget?.used ?? 0} · 预留 {budget?.reserved ?? 0} · 剩余 {budget?.remaining ?? 0}</span><Tag>{active} 项制作中</Tag><Button size="small" loading={modelStatus === 'loading'} onClick={refreshModels}>刷新制作能力</Button>{failures.actionable > 0 && <Tag color="warning">{failures.actionable} 项待补做</Tag>}</div>
    {failures.actionable > 0 && <Alert type="warning" message="部分内容还没有可用结果，只需补做这些项" description={<div className="sd-actions">{failures.retry.map(group => <Button key={group.kind} onClick={() => retry(group.kind, group.ids, `仅补做失败的${(kinds.find(([k]) => k === group.kind)?.[1] || '成片')}（${Math.min(12,group.ids.length)} 项）`)}>补做{kinds.find(([k]) => k === group.kind)?.[1] || '成片'} · {Math.min(12,group.ids.length)} 项</Button>)}<span>模型制作先查看消耗再确认；成片只重新合成，已有选片不会改变。</span></div>} />}
    {failures.total > 0 && <Collapse ghost items={[{ key:'failed-history',label:`历史失败记录 · ${failures.total} 个候选${failures.actionable ? '' : '（当前无需补做）'}`,children:<p>失败记录保留供排查，不代表当前作品未完成。有已选用、待选用或正在补做的结果时，不会重复补做。导出失败可在出成片步骤重新导出。</p> }]} />}
    {!p.production && <Alert type="info" message="先确认制作方案：当前推荐使用 akool-maas，确认后会固定到本作品。" />}
    {modelStatus === 'loading' && <p aria-live="polite">正在检查制作能力…</p>}
    {modelStatus === 'error' && <Alert type="warning" message="制作能力暂时读取失败，请刷新重试。已有作品和素材仍保留。" />}
    {modelStatus === 'ready' && missing.length > 0 && <Alert type="info" message={`当前制作方案缺少：${missing.map(([, label]) => label).join('、')}。可在下方按能力选择其他供应商，也可以手工编写或上传素材。`} />}
    {archiveFailures > 0 && <Alert type="warning" message={`${archiveFailures} 项素材归档尚未完成，系统会重试。源结果已保留，长期可用性仍待确认。`} action={<Button onClick={() => run(async () => { await flush(); await dramaApi.retryArchives(project.id); await reload(); })}>重试归档</Button>} />}
    {project.archived && <Alert type="warning" message="作品已归档，暂停新生成；可在我的作品中恢复。" />}
    <Collapse ghost items={[{ key: 'production', label: '制作方案、预算与历史版本', children: <div className="sd-editor">
      <label>默认供应商（更改后需重新选择各能力配置）</label><Select aria-label="制作供应商" value={provider} options={[...new Set(['akool-maas', ...models.map(m => m.provider).filter((v): v is string => !!v)])].map(value => ({ value, label: value }))} onChange={value => edit({ ...p, production: { provider: value, models: {} } })} />
      {!p.production && <Button onClick={() => edit({ ...p, production: { provider, models: {} } })}>确认使用 {provider}</Button>}
      <label>作品画幅（生成图片前确定）</label><Select aria-label="作品画幅" value={p.frame?.ratio || '9:16'} options={['9:16','16:9','1:1'].map(value => ({value,label:value}))} onChange={ratio => edit({ ...p, frame: { ratio: ratio as '9:16' | '16:9' | '1:1', fit: p.frame?.fit || 'contain', voiceVolume: p.frame?.voiceVolume ?? 100 } })} />
      <p>每项能力可以使用不同供应商。例如图片与视频使用 MaaS，旁白使用 OpenAPI；选择会随作品保存。</p>
      {kinds.map(([kind, label]) => <div key={kind}><label>{label}配置 · {p.production?.providers?.[kind] || provider}</label><Select showSearch optionFilterProp="label" aria-label={`${label}配置`} style={{ width: '100%' }} allowClear placeholder="选择可用模型（可跨供应商）" value={p.production?.models?.[kind]} options={models.filter(m => m.kinds.includes(kind)).map(m => ({ value: m.configId, label: `${m.name} · ${m.provider}` }))} onChange={value => {
        const chosen = models.find(m => m.configId === value);
        const providers = { ...p.production?.providers }; if (chosen?.provider) providers[kind] = chosen.provider; else delete providers[kind];
        edit({ ...p, production: { ...p.production, provider, providers, models: { ...p.production?.models, [kind]: value }, ...(kind === 'voice' ? { voiceParameters: {} } : {}) } });
      }} /></div>)}
      <label>项目预算上限（积分，不会充值或扣款）</label><InputNumber aria-label="项目预算上限" min={0} max={1000000} precision={6} value={limit} onChange={value => setLimit(value ?? 0)} /><Button onClick={() => run(async () => { await mutate(saved => dramaApi.budget(saved.id, saved.revision, limit)); })}>保存预算上限</Button>
      <p>项目预算用于按预估消耗检查是否允许开始新任务，不是账号余额。调高预算不会充值。任务按实际用量结算，可能超过预估；预算不足时不再开始新任务。预算包含已用和已预留金额，失败退款确认后释放。</p>
      {!!project.history?.length && <><label>恢复草稿历史（最近 20 次保存）</label><Select<number> aria-label="草稿历史" placeholder="选择历史版本" options={[...project.history].reverse().map(h => ({ value: h.revision, label: `版本 ${h.revision} · ${new Date(h.savedAt).toLocaleString()}` }))} onChange={target => Modal.confirm({ title: '恢复这份草稿？', content: '会更新文字、设定和选片，当前草稿先保存到历史。不会删除候选、调用模型或重新扣费。', onOk: () => run(async () => { await mutate(saved => dramaApi.restore(saved.id, saved.revision, target)); }) })} /></>}
    </div> }]} />
  </section>;
}
