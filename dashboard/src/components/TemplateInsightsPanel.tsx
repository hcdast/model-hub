import { useEffect, useState } from 'react';
import { Alert, Button, Card, Pagination, Segmented, Space, Statistic, Tag } from 'antd';
import Table from './AdminTable';
import api from '../services/api';
import CreationFunnelPanel from './CreationFunnelPanel';

interface Metrics { copies: number; creators: number; startedProjects: number; completedProjects: number }
interface Insights { items: Array<{ id: string; name: string; published: boolean; source: string; metrics: Metrics }>; total: number; totals: Omit<Metrics, 'creators'>; computedAt: string }
const percent = (completed: number, copies: number) => copies ? `${(completed / copies * 100).toFixed(1)}%` : '—';
export default function TemplateInsightsPanel() {
  const [kind, setKind] = useState<'short-drama' | 'workflow'>('short-drama');
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const [data, setData] = useState<Insights>();
  useEffect(() => {
    let active = true; setLoading(true); setError(false); setData(undefined);
    void api.get<never, { data: Insights }>('/creation-templates/insights', { params: { kind, page } })
      .then(result => { if (active) setData(result.data); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, page, revision]);
  const finished = kind === 'short-drama' ? '导出成功' : '运行成功';
  return <Card title="模板复用效果" extra={<Button onClick={() => setRevision(v => v + 1)}>刷新效果数据</Button>} style={{ marginBottom: 24 }}>
    <Segmented aria-label="模板效果类型" value={kind} onChange={value => { setKind(value as typeof kind); setPage(1); }} options={[{ value: 'short-drama', label: '短剧模板' }, { value: 'workflow', label: '工作流模板' }]} />
    <p>统计当前保留、可确认来源的直接模板副本；跨版本汇总，每个项目在各阶段只计一次。归档项目保留，删除项目移出统计；历史来源不明的项目不推算。数据最多缓存一分钟。</p>
    <p>短剧完成以成片导出成功为准；工作流完成以至少一次运行成功为准。启动后失败仍计入“启动制作”，上传自有素材不等于启动模型制作。完成率为{finished}项目数 / 创建副本数，不代表画质评价或下载完成。</p>
    {error && <Alert type="error" message="模板效果数据加载失败" action={<Button onClick={() => setRevision(v => v + 1)}>重试加载效果</Button>} />}
    <Space wrap size={32} style={{ margin: '16px 0' }}><Statistic title="创建副本" value={data?.totals.copies ?? '—'} /><Statistic title="启动制作" value={data?.totals.startedProjects ?? '—'} /><Statistic title={finished} value={data?.totals.completedProjects ?? '—'} /><Statistic title="完成率" value={data ? percent(data.totals.completedProjects, data.totals.copies) : '—'} /></Space>
    <Table size="small" rowKey="id" loading={loading} dataSource={data?.items || []} pagination={false} scroll={{ x: 850 }} columns={[
      { title: '模板名称', dataIndex: 'name' }, { title: '可发现状态', dataIndex: 'published', render: published => <Tag>{published ? '已公开' : '不可发现'}</Tag> },
      { title: '创建副本', render: (_, row) => row.metrics.copies }, { title: '独立创作者', render: (_, row) => row.metrics.creators },
      { title: '启动制作', render: (_, row) => row.metrics.startedProjects }, { title: finished, render: (_, row) => row.metrics.completedProjects },
      { title: '完成率', render: (_, row) => percent(row.metrics.completedProjects, row.metrics.copies) },
    ]} />
    {!!data && data.total > 20 && <Pagination pageSize={20} current={page} total={data.total} showSizeChanger={false} onChange={setPage} />}
    {data?.computedAt && <p style={{ color: 'var(--text-secondary)' }}>统计时间：{new Date(data.computedAt).toLocaleString()}</p>}
    <CreationFunnelPanel kind={kind} revision={revision} />
  </Card>;
}
