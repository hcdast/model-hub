import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Select, Space, message } from 'antd';
import { creationApi, ShotWorkflowLink } from '../../services/creation-api';
import { getApiErrorMessage } from '../../store/auth-store';

interface Run { runId: string; workflowId: string; nodeStates?: Array<{ nodeId: string; status: string; output?: unknown }> }
export default function WorkflowDramaBridge({ workflowId, run, disabled }: { workflowId: string; run?: Run | null; disabled?: boolean }) {
  const navigate = useNavigate();
  const [link, setLink] = useState<ShotWorkflowLink | null>(null), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  const [nodeId, setNodeId] = useState<string>(), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; setLink(null); setNodeId(undefined); setError(false); void creationApi.shotWorkflow(workflowId).then(value => { if (active) setLink(value); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [workflowId, revision]);
  if (error) return <Alert type="warning" message="镜头关联查询失败" action={<Button onClick={() => setRevision(v => v + 1)}>重试</Button>} />;
  if (!link) return null;
  const outputs = run?.workflowId === workflowId ? run.nodeStates?.filter(n => n.status === 'succeeded' && n.output && typeof n.output === 'object' && typeof (n.output as Record<string, unknown>)[link.kind] === 'string') || [] : [];
  const selected = outputs.find(n => n.nodeId === nodeId)?.nodeId || outputs[0]?.nodeId;
  return <Alert type="info" showIcon message={`当前镜头的自定义流程 · 基于作品版本 ${link.sourceRevision}`} description="模型任务计入原短剧项目预算，按节点预留费用上限；预算不足时停止后续模型任务，已提交任务继续结算。加入候选不会覆盖选片；镜头设定变化后需从原作品重新创建流程。" action={<Space wrap>
    <Select aria-label="返回镜头的输出节点" placeholder="选择成功的媒体节点" value={selected} onChange={setNodeId} options={outputs.map(n => ({ value: n.nodeId, label: n.nodeId }))} style={{ minWidth: 150 }} />
    <Button disabled={disabled || !run || !selected} loading={busy} onClick={async () => { if (!run || !selected) return; setBusy(true); try { await creationApi.importShotOutput(link.id, run.runId, selected); message.success('已加入原镜头候选，请返回作品预览并选用'); } catch (error) { message.error(getApiErrorMessage(error, '结果加入失败')); } finally { setBusy(false); } }}>加入原镜头候选</Button>
    <Button onClick={() => navigate(`/short-dramas/${link.projectId}?shot=${encodeURIComponent(link.shotId)}&step=${link.kind === 'image' ? 2 : 3}`)}>返回原镜头</Button>
  </Space>} />;
}
