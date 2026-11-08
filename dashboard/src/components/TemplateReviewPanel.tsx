import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Input, Pagination, Popconfirm, Space, Spin, Tag, message } from 'antd';
import Table from './AdminTable';
import api from '../services/api';
import { usePermission } from '../hooks/usePermission';

interface Submission { _id: string; name: string; kind: string; sourceId: string; sourceRevision: number; description: string; instructions: string; status: string; reviewNote: string; workflowDefinition?: unknown; dramaPlan?: unknown }
const states: Record<string, string> = { pending: '待审核', published: '已发布', rejected: '未通过', withdrawn: '已下架' };
export default function TemplateReviewPanel() {
  const { hasPermission } = usePermission();
  const canReview = hasPermission('workflow:update');
  const [items, setItems] = useState<Submission[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false), [error, setError] = useState(false), [open, setOpen] = useState(false), [detail, setDetail] = useState<Submission>();
  const [detailLoading, setDetailLoading] = useState(false), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setError(false);
    void api.get<never, { data: { items: Submission[]; total: number } }>('/creation-templates', { params: { page } }).then(r => { if (active) { setItems(r.data.items); setTotal(r.data.total); } }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision]);
  const review = async (action: 'publish' | 'reject' | 'withdraw') => {
    if (!detail) return; setBusy(true);
    try { await api.put(`/creation-templates/${detail._id}/review`, { action, note }); message.success('审核状态已更新'); setOpen(false); setRevision(v => v + 1); }
    catch { message.error('审核失败，请检查权限或稍后重试'); }
    finally { setBusy(false); }
  };
  return <Card title="创作模板投稿与审核" extra={<Button onClick={() => setRevision(v => v + 1)}>刷新投稿</Button>} style={{ marginBottom: 24 }}>
    <p>检查故事或流程、提示词、输入要求和使用限制。发布后将进入发现页，供其他用户创建独立副本。</p>
    {error && <Alert type="error" message="模板投稿加载失败" action={<Button onClick={() => setRevision(v => v + 1)}>重试</Button>} />}
    <Table<Submission> size="small" rowKey="_id" loading={loading} dataSource={items} pagination={false} columns={[
      { title: '模板', dataIndex: 'name' }, { title: '类型', dataIndex: 'kind', render: kind => kind === 'short-drama' ? '短剧项目' : '工作流' },
      { title: '状态', dataIndex: 'status', render: status => <Tag color={status === 'published' ? 'green' : undefined}>{states[status] || status}</Tag> },
      { title: '操作', render: (_, item) => <Button onClick={async () => { setOpen(true); setDetail(undefined); setDetailLoading(true); try { const r = await api.get<never, { data: Submission }>(`/creation-templates/${item._id}`); setDetail(r.data); setNote(r.data.reviewNote || ''); } catch { message.error('快照读取失败，请关闭后重试'); } finally { setDetailLoading(false); } }}>查看快照与审核</Button> },
    ]} />
    {total > 20 && <Pagination current={page} total={total} pageSize={20} showSizeChanger={false} onChange={setPage} />}
    <Drawer title="模板快照审核" open={open} width={760} onClose={busy ? undefined : () => setOpen(false)}>
      {detailLoading ? <Spin /> : detail && <><Descriptions column={1} bordered items={[
        { key: 'name', label: '模板名称', children: detail.name }, { key: 'description', label: '用途', children: detail.description },
        { key: 'instructions', label: '使用说明', children: detail.instructions }, { key: 'source', label: '来源与版本', children: `${detail.sourceId} / ${detail.sourceRevision}` },
      ]} /><p>以下为去除素材、选片、运行结果和密钥后的实际发布快照。</p><pre style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(detail.workflowDefinition || detail.dramaPlan, null, 2)}</pre>
        <Input.TextArea aria-label="模板审核意见" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000} placeholder="填写审核意见，投稿者可见" />
        {canReview && <Space style={{ marginTop: 16 }} wrap><Popconfirm title="确认审核通过并公开发布？" onConfirm={() => review('publish')}><Button type="primary" loading={busy}>通过并发布</Button></Popconfirm><Button disabled={busy} onClick={() => void review('reject')}>退回修改</Button><Popconfirm title="确认从发现页下架？已有用户副本保留。" onConfirm={() => review('withdraw')}><Button danger disabled={busy}>下架</Button></Popconfirm></Space>}
      </>}
    </Drawer>
  </Card>;
}
