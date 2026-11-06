import Table from '../components/AdminTable';
import dayjs from 'dayjs';
import { MODEL_CONFIG_MODEL_TYPES } from '../constants/model-config-model-type';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Card, Select, Button, Space, Tooltip, Input, DatePicker, Tag, Popconfirm, message, Collapse, Typography } from 'antd';
import RequestFeedback from '../components/RequestFeedback';
import { ErrorHandler } from '../utils/error-handler';
import { ReloadOutlined, StopOutlined } from '@ant-design/icons';
import StatusTag from '../components/StatusTag';
import { useSearchParams } from 'react-router-dom';
import ProviderSelect from '../components/ProviderSelect';
import { useRequest } from '../hooks/useRequest';
import PageHeader from '../components/PageHeader';
import { taskApi } from '../services/api';
import { priorityToLabel, formatDateTime } from '../utils/format-helpers';
import { usePermission } from '../hooks/usePermission';

const STATUS_OPTIONS = ['PENDING', 'SUBMITTED', 'PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'];

export default function TasksPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canUpdateTask = hasPermission('task:update');
  const [search, setSearch] = useSearchParams();
  const params: Record<string, any> = Object.fromEntries(search);
  params.page = Number(params.page) || 1; params.pageSize = Number(params.pageSize) || 20;
  const failureView = params.view === 'failures';
  if (failureView) params.failureOnly = '1';
  const update = (patch: Record<string, any>) => { const next = new URLSearchParams(search); Object.entries({ page: 1, ...patch } as Record<string, any>).forEach(([k,v]) => v === undefined || v === '' ? next.delete(k) : next.set(k, String(v))); setSearch(next, { replace: true }); };
  const { data = { items: [], total: 0 }, error, loading, paused, setPaused, lastSuccess, refresh: fetchData } = useRequest<any>(async () => (await taskApi.list(params) as any).data, { deps: [search.toString()], pollingInterval: 15000 });
  const { data: failureSummary, loading: summaryLoading, error: summaryError, refresh: refreshSummary } = useRequest<any>(async () => failureView ? (await taskApi.failureSummary(params) as any).data : undefined, { deps: [search.toString()], pollingInterval: failureView && !paused ? 15000 : 0 });
  const [draftFilters, setDraftFilters] = useState({ taskId: params.taskId || '', model: params.model || '', client: params.client || '' });
  useEffect(() => setDraftFilters({ taskId: params.taskId || '', model: params.model || '', client: params.client || '' }), [search.toString()]);
  const columns = [
    { title: 'TaskId', dataIndex: 'taskId', key: 'taskId', fixed: 'left' as const, width: 220, ellipsis: true,
      render: (id: string) => <a onClick={() => navigate(`/tasks/${id}`)}>{id}</a>,
    },
    {
      title: '客户端',
      dataIndex: 'clientName',
      key: 'clientName',
      width: 160,
      ellipsis: true,
      render: (name: string | null | undefined, record: { apiKey?: string }) => {
        const label = name || '—';
        return record.apiKey ? (
          <Tooltip title={`apiKey: ${record.apiKey}`}>
            <span>{label}</span>
          </Tooltip>
        ) : (
          <span>{label}</span>
        );
      },
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 120, render: (s: string) => <StatusTag status={s} /> },
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 100,
      render: (v: number) => {
        if (v == null) return '-';
        const { label, color } = priorityToLabel(v);
        return <span>{v} <Tag color={color}>{label}</Tag></span>;
      },
    },
    { title: '模型 / 供应商', dataIndex: 'model', key: 'model', width: 210, render: (v: string, r: any) => <div><Typography.Text ellipsis={{ tooltip: v }} style={{ display: 'block' }}>{v}</Typography.Text><Typography.Text type="secondary">{r.provider || '—'}</Typography.Text></div> },
    { title: '功能类型', dataIndex: 'featureType', key: 'featureType', width: 140 },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180,
      render: (t: string) => formatDateTime(t),
    },
    { title: '操作', key: 'actions', fixed: 'right' as const, width: 160,
      render: (_: any, record: any) => (
        <Space>
          <a onClick={() => navigate(`/tasks/${record.taskId}`)}>任务详情</a>
          {canUpdateTask && record.canCancel && (
            <Popconfirm
              title="确认取消该任务？"
              onConfirm={async () => {
                try {
                  await taskApi.cancel(record.taskId);
                  message.success('任务已取消');
                  fetchData();
                } catch (err) { ErrorHandler.handleApiError(err, '取消失败'); }
              }}
              okText="确认"
              cancelText="取消"
            >
              <Button type="link" danger size="small" icon={<StopOutlined />}>取消</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 12 }}>上次成功刷新：{lastSuccess?.toLocaleString() || '—'} <Button size="small" onClick={() => setPaused(!paused)}>{paused ? '恢复自动刷新' : '暂停自动刷新'}</Button></div>
      {data.staleCount > 0 && <Alert showIcon type="warning" message={`${data.staleCount} 个任务超过 15 分钟没有状态更新`} description="请进入任务诊断核对队列、供应商结果和账单；时间过长本身不代表失败。" action={<Button onClick={() => update({ staleMinutes: 15, status: undefined, view: undefined, failureOnly: undefined, errorCode: undefined })}>查看待排查任务</Button>} style={{ marginBottom: 12 }} />}
      <PageHeader
        title="任务记录"
        leftExtra={<Space><Button type={!failureView ? 'primary' : 'default'} onClick={() => update({ view: undefined, failureOnly: undefined, errorCode: undefined })}>任务列表</Button><Button type={failureView ? 'primary' : 'default'} onClick={() => update({ view: 'failures', failureOnly: '1', status: undefined, staleMinutes: undefined })}>失败聚合分析</Button></Space>}
        extra={<Space><Button onClick={() => setSearch(failureView ? { view: 'failures', failureOnly: '1' } : {})}>重置筛选</Button><Button icon={<ReloadOutlined />} onClick={() => { void fetchData(); if (failureView) void refreshSummary(); }}>刷新</Button></Space>}
        toolbar={<>
          <div className="admin-filter-grid">
            <label>任务 ID<Input.Search placeholder="精确任务 ID" value={draftFilters.taskId} onChange={e => setDraftFilters(v => ({ ...v, taskId: e.target.value }))} onSearch={v => update({ taskId: v })} allowClear /></label>
            <label>供应商<ProviderSelect value={params.provider} onChange={v => update({ provider: v })} style={{ width: '100%' }} /></label>
            <label>状态<Select placeholder="全部状态" allowClear style={{ width: '100%' }} options={(failureView ? ['FAILED', 'TIMEOUT'] : STATUS_OPTIONS).map(value => ({ value, label: value }))} value={params.status} onChange={status => update({ status })} /></label>
          </div>
          <Collapse ghost style={{ marginTop: 8 }} items={[{ key: 'advanced', label: '高级筛选', children: <div className="admin-filter-grid">
            <label>模型标识<Input.Search placeholder="精确模型标识" value={draftFilters.model} onChange={e => setDraftFilters(v => ({ ...v, model: e.target.value }))} onSearch={model => update({ model })} allowClear /></label>
            <label>客户端<Input.Search placeholder="客户端 ID / Portal 标识" value={draftFilters.client} onChange={e => setDraftFilters(v => ({ ...v, client: e.target.value }))} onSearch={client => update({ client })} allowClear /></label>
            <label>错误码<Input.Search key={params.errorCode || ''} placeholder="精确错误码" defaultValue={params.errorCode} onSearch={errorCode => update({ errorCode })} allowClear /></label>
            <label>功能类型<Select allowClear style={{ width: '100%' }} value={params.featureType} onChange={featureType => update({ featureType })} options={[...MODEL_CONFIG_MODEL_TYPES, 'image_generate', 'image_to_video', 'text_to_video', 'reference_to_video', 'video_to_video', 'head_swap', 'character_swap'].map(value => ({ value, label: value }))} /></label>
            <label>创建时间<DatePicker.RangePicker style={{ width: '100%' }} showTime value={params.from && params.to ? [dayjs(params.from), dayjs(params.to)] : null} onChange={v => update({ from: v?.[0]?.toISOString(), to: v?.[1]?.toISOString() })} /></label>
            <label>长期未完成<Select placeholder="全部时长" disabled={failureView} allowClear style={{ width: '100%' }} value={params.staleMinutes} options={[{ value: '15', label: '超过 15 分钟' }, { value: '30', label: '超过 30 分钟' }, { value: '1440', label: '超过 24 小时' }]} onChange={staleMinutes => update({ staleMinutes })} /></label>
          </div> }]} />
          <Space wrap>{Object.entries({ taskId: '任务', provider: '供应商', status: '状态', model: '模型', client: '客户端', errorCode: '错误码', featureType: '功能', staleMinutes: '未完成分钟数', from: '开始', to: '结束' }).filter(([key]) => params[key]).map(([key, label]) => <Tag key={key} closable onClose={() => update(key === 'from' || key === 'to' ? { from: undefined, to: undefined } : { [key]: undefined })}>{label}：{params[key]}</Tag>)}</Space>
        </>}
      />
      <RequestFeedback error={error} hasData={!!lastSuccess} retry={fetchData} />
      {failureView && <Card title={`失败及超时聚合 · 共 ${failureSummary?.total ?? '—'} 个任务`} extra={<span>按当前筛选统计，最多显示 30 组</span>} style={{ marginBottom: 16 }}>
        {summaryError && <Alert type="error" showIcon message="失败聚合加载失败，请刷新重试" />}
        <Table loading={summaryLoading} dataSource={failureSummary?.items || []} rowKey={r => JSON.stringify([r.provider, r.model, r.errorCode])} pagination={false} size="small" columns={[
          { title: '供应商', dataIndex: 'provider', key: 'provider' },
          { title: '模型', dataIndex: 'model', key: 'model' },
          { title: '错误码', dataIndex: 'errorCode', key: 'errorCode' },
          { title: '失败数量', dataIndex: 'count', key: 'count', width: 100 },
          { title: '操作', key: 'actions', width: 110, render: (_, r) => <Button type="link" onClick={() => update({ provider: r.provider, model: r.model, errorCode: r.errorCode, failureOnly: '1', status: undefined, staleMinutes: undefined })}>查看任务</Button> },
        ]} />
      </Card>}
      <Card>
        <Table
          columnPriority={['taskId', 'status', 'actions', 'model', 'createdAt', 'clientName', 'featureType', 'priority']}
          columns={columns} dataSource={data.items} rowKey="taskId" loading={loading} size="small"
          locale={{ emptyText: error ? '加载失败，请点击重试' : undefined }}
          pagination={{
            current: params.page, pageSize: params.pageSize, total: data.total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => update({ page: p, pageSize: ps }),
          }}
        />
      </Card>
    </div>
  );
}
