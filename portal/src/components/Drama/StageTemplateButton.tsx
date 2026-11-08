import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Radio, Select, message } from 'antd';
import { dramaTemplateCatalogApi, type DramaTemplateSummary } from '../../services/drama-template-api';
import portalApi from '../../services/auth-api';
import { getApiErrorMessage } from '../../store/auth-store';
import type { DramaProject } from '../../services/drama-api';

export default function StageTemplateButton({ projectId, prepare, reload, disabled, sources = [] }: { projectId: string; prepare: () => Promise<number>; reload: () => Promise<unknown>; disabled?: boolean; sources?: DramaProject['stageTemplates'] }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [stage, setStage] = useState<'characters' | 'storyboard'>('characters'), [templates, setTemplates] = useState<DramaTemplateSummary[]>([]), [selected, setSelected] = useState<string>(), [search, setSearch] = useState('');
  useEffect(() => { if (!open) return; const abort = new AbortController(); setLoading(true); setError('');
    const timer = window.setTimeout(() => { void dramaTemplateCatalogApi.list(search, 1, abort.signal).then(r => setTemplates(r.items)).catch(e => { if (!abort.signal.aborted) setError(getApiErrorMessage(e, '模板加载失败')); }).finally(() => { if (!abort.signal.aborted) setLoading(false); }); }, 200);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [open, search]);
  return <><Button disabled={disabled} onClick={() => setOpen(true)}>阶段模板</Button><Modal title="从模板追加角色或分镜" open={open} okText="保存并追加" okButtonProps={{ disabled: !selected || loading }} confirmLoading={busy} onCancel={busy ? undefined : () => setOpen(false)} onOk={async () => {
    if (!selected) return; setBusy(true); setError('');
    try { const revision = await prepare(); await portalApi.post(`/short-dramas/${projectId}/stage-templates`, { revision, templateId: selected, stage }); await reload(); setOpen(false); message.success('已追加模板内容，请检查并重新确认角色和分镜'); }
    catch (e) { setError(getApiErrorMessage(e, '无法应用模板')); } finally { setBusy(false); }
  }}><Alert type="info" showIcon message="已有内容与选片保留，不会启动生成" description="角色模板只追加角色；分镜模板同时追加其角色、场景和镜头。会生成新的条目 ID，并记录模板版本。每集最多 8 个角色、8 个场景、24 个镜头、180 秒；超限时整次拒绝，不做部分追加。" />
    <p><Radio.Group value={stage} onChange={e => setStage(e.target.value)} options={[{ value: 'characters', label: '角色设定' }, { value: 'storyboard', label: '分镜结构' }]} /></p>
    <Select aria-label="阶段模板选择" style={{ width: '100%' }} value={selected} showSearch filterOption={false} onSearch={setSearch} onChange={setSelected} loading={loading} placeholder="搜索已公开短剧模板" options={templates.map(t => ({ value: t.id, label: `${t.name} · v${t.version}` }))} />
    {error && <Alert type="error" message={error} />}
    {!!sources.length && <><h4>最近应用记录</h4>{sources.slice(-5).reverse().map((source, i) => <p key={i}>{source.stage === 'characters' ? '角色设定' : '分镜结构'} · 模板 {source.id} · v{source.version} · 作品修订 {source.revision}</p>)}</>}
  </Modal></>;
}
