import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Card, Select, Button, Space, Tooltip, Tag, Popconfirm, message } from 'antd';
import { ErrorHandler } from '../utils/error-handler';
import { ReloadOutlined, StopOutlined } from '@ant-design/icons';
import StatusTag from '../components/StatusTag';
import PageHeader from '../components/PageHeader';
import { taskApi } from '../services/api';
import { priorityToLabel, formatDateTime } from '../utils/format-helpers';
import { usePermission } from '../hooks/usePermission';

const STATUS_OPTIONS = ['PENDING', 'SUBMITTED', 'PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED'];

export default function TasksPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canUpdateTask = hasPermission('task:update');
  const [data, setData] = useState<any>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState({ page: 1, pageSize: 20, status: undefined as string | undefined });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: any = await taskApi.list(params);
      setData(res.data || { items: [], total: 0 });
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [params.page, params.pageSize, params.status]);

  const columns = [
    { title: 'TaskId', dataIndex: 'taskId', key: 'taskId', width: 220, ellipsis: true,
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
    { title: '操作', key: 'actions', width: 160,
      render: (_: any, record: any) => (
        <Space>
          <a onClick={() => navigate(`/tasks/${record.taskId}`)}>详情</a>
          {canUpdateTask && (record.status === 'PENDING' || record.status === 'SUBMITTED') && (
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
      <PageHeader
        title="任务记录"
        extra={(
          <>
            <Select
              placeholder="状态筛选"
              allowClear
              style={{ width: 160 }}
              options={STATUS_OPTIONS.map((s) => ({ label: s, value: s }))}
              value={params.status}
              onChange={(v) => setParams({ ...params, status: v, page: 1 })}
            />
            <Button icon={<ReloadOutlined />} onClick={fetchData}>
              刷新
            </Button>
          </>
        )}
      />
      <Card>
        <Table
          columns={columns} dataSource={data.items} rowKey="taskId" loading={loading} size="small"
          pagination={{
            current: params.page, pageSize: params.pageSize, total: data.total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => setParams({ ...params, page: p, pageSize: ps }),
          }}
        />
      </Card>
    </div>
  );
}
