import { useEffect, useState } from 'react';
import { Button, Modal, Select, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { creationApi } from '../../services/creation-api';
import { getApiErrorMessage } from '../../store/auth-store';
import { templateCatalogApi, type TemplateSummary } from '../../services/template-api';

export default function ShotWorkflowButton({ projectId, shotId, prepare, disabled }: {
  projectId: string; shotId: string; prepare: () => Promise<number>; disabled?: boolean;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false), [kind, setKind] = useState<'image' | 'video'>('image'), [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]), [templateId, setTemplateId] = useState<string>(), [search, setSearch] = useState('');
  useEffect(() => { if (!open) return; const abort = new AbortController(); const timer = window.setTimeout(() => {
    void templateCatalogApi.list({ search, page: 1, pageSize: 48 }, abort.signal).then(r => setTemplates(r.items)).catch(() => { if (!abort.signal.aborted) message.warning('工作流模板加载失败，仍可使用当前镜头创建'); });
  }, 200); return () => { window.clearTimeout(timer); abort.abort(); }; }, [open, search]);
  return <><Button disabled={disabled} onClick={() => setOpen(true)}>高级流程</Button><Modal open={open} title="为当前镜头创建高级流程" okText="保存并打开画布" cancelText="取消" confirmLoading={busy} onCancel={busy ? undefined : () => setOpen(false)} onOk={async () => {
    setBusy(true);
    try { const revision = await prepare(); const link = await creationApi.createShotWorkflow({ projectId, shotId, kind, revision, templateId }); navigate(`/workflows/${link.workflowId}`); }
    catch (error) { message.error(getApiErrorMessage(error, '无法创建高级流程')); }
    finally { setBusy(false); }
  }}><p>以当前镜头的提示词和模型创建可编辑流程。请在画布里确认素材和参数，再手动运行。</p><p>高级流程的模型任务计入原短剧项目预算，每个节点提交前预留该次费用上限；预算不足会停止后续模型任务，已经完成的任务仍会结算。此操作只创建流程，不启动生成。结果可加入原镜头候选，已有选片保留。</p><Select aria-label="高级流程输出类型" value={kind} onChange={setKind} options={[{ value: 'image', label: '分镜画面' }, { value: 'video', label: '镜头视频' }]} /><p>可选择已公开工作流模板作为镜头流程。模板按版本复制，输入和模型须在画布重新检查；媒体结果类型必须与所选类型一致。</p><Select aria-label="镜头流程模板" style={{ width: "100%" }} allowClear showSearch filterOption={false} placeholder="默认：使用当前镜头" value={templateId} onChange={setTemplateId} onSearch={setSearch} options={templates.map(t => ({ value: t.id, label: `${t.name} · v${t.version}` }))} /></Modal></>;
}
