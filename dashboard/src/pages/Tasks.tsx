import dayjs from 'dayjs';
import { MODEL_CONFIG_MODEL_TYPES } from '../constants/model-config-model-type';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Alert, Card, Select, Button, Space, Tooltip, Input, DatePicker, Tag, Popconfirm, message } from 'antd';
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
  const update = (patch: Record<string, any>) => { const next = new URLSearchParams(search); Object.entries({ page: 1, ...patch } as Record<string, any>).forEach(([k,v]) => v === undefined || v === '' ? next.delete(k) : next.set(k, String(v))); setSearch(next, { replace: true }); };
  const { data = { items: [], total: 0 }, loading, paused, setPaused, lastSuccess, refresh: fetchData } = useRequest<any>(async () => (await taskApi.list(params) as any).data, { deps: [search.toString()], pollingInterval: 15000 });
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
    { title: '模型', dataIndex: 'model', key: 'model', ellipsis: true },
    { title: '厂商', dataIndex: 'provider', key: 'provider', width: 130 },
    { title: '功能类型', dataIndex: 'featureType', key: 'featureType', width: 140 },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180,
      render: (t: string) => formatDateTime(t),
    },
    { title: '操作', key: 'actions', fixed: 'right' as const, width: 160,
      render: (_: any, record: any) => (
        <Space>
          <a onClick={() => navigate(`/tasks/${record.taskId}`)}>详情</a>
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
      {data.staleCount > 0 && <Alert showIcon type="warning" message={`${data.staleCount} 个任务超过 15 分钟没有状态更新`} description="请进入任务诊断核对队列、供应商结果和账单；时间过长本身不代表失败。" action={<Button onClick={() => update({ staleMinutes: 15, status: undefined })}>查看待排查任务</Button>} style={{ marginBottom: 12 }} />}
      <PageHeader
        title="任务记录"
        extra={(
          <>
            <Input.Search placeholder="精确任务 ID" value={draftFilters.taskId} onChange={e => setDraftFilters(v => ({ ...v, taskId: e.target.value }))} onSearch={v => update({ taskId: v })} allowClear style={{width: 220}} />
            <Input.Search placeholder="模型标识" value={draftFilters.model} onChange={e => setDraftFilters(v => ({ ...v, model: e.target.value }))} onSearch={v => update({ model: v })} allowClear style={{width: 180}} />
            <Input.Search placeholder="客户端 ID / Portal 标识" value={draftFilters.client} onChange={e => setDraftFilters(v => ({ ...v, client: e.target.value }))} onSearch={v => update({ client: v })} allowClear style={{width: 210}} />
            <ProviderSelect value={params.provider} onChange={v => update({provider:v})} />
            <Select placeholder="功能类型" allowClear style={{width:160}} value={params.featureType} onChange={v => update({featureType:v})} options={[...MODEL_CONFIG_MODEL_TYPES, 'image_generate','image_to_video','text_to_video','reference_to_video','video_to_video','head_swap','character_swap'].map(value=>({value,label:value}))} />
            <DatePicker.RangePicker showTime value={params.from && params.to ? [dayjs(params.from),dayjs(params.to)] : null} onChange={v => update({from:v?.[0]?.toISOString(),to:v?.[1]?.toISOString()})} />
            <Select placeholder="长期未完成" allowClear value={params.staleMinutes} style={{width:150}} options={[{value:'15',label:'超过 15 分钟'},{value:'30',label:'超过 30 分钟'},{value:'1440',label:'超过 24 小时'}]} onChange={v=>update({staleMinutes:v})} />
            <Select
              placeholder="状态筛选"
              allowClear
              style={{ width: 160 }}
              options={STATUS_OPTIONS.map((s) => ({ label: s, value: s }))}
              value={params.status}
              onChange={(v) => update({ status: v })}
            />
            <Button icon={<ReloadOutlined />} onClick={fetchData}>
              刷新
            </Button>
          </>
        )}
      />
      <Card>
        <Table
          columns={columns} dataSource={data.items} rowKey="taskId" loading={loading} size="small" scroll={{ x: 1400 }}
          pagination={{
            current: params.page, pageSize: params.pageSize, total: data.total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => update({ page: p, pageSize: ps }),
          }}
        />
      </Card>
    </div>
  );
}
