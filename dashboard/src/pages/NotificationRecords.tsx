import { useEffect, useState } from 'react';
import { Table, Card, Tag, Select, DatePicker, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { notificationRecordApi } from '../services/api';

const statusColor: Record<string, string> = { success: 'green', failed: 'red', suppressed: 'orange' };
const statusLabel: Record<string, string> = { success: '成功', failed: '失败', suppressed: '已抑制' };

export default function NotificationRecordsPage() {
  const [data, setData] = useState<any>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, pageSize: 20 });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: any = await notificationRecordApi.list(params);
      setData(res.data || { items: [], total: 0 });
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [params]);

  const columns = [
    { title: '规则名称', dataIndex: 'ruleName', width: 160 },
    { title: '事件类型', dataIndex: 'eventType', width: 180, render: (v: string) => <Tag>{v}</Tag> },
    { title: '严重级别', dataIndex: 'severity', width: 100, render: (v: string) => <Tag color={v === 'critical' ? 'red' : v === 'warning' ? 'orange' : 'blue'}>{v}</Tag> },
    { title: '渠道', dataIndex: 'channelType', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={statusColor[v]}>{statusLabel[v] || v}</Tag> },
    { title: '尝试次数', dataIndex: 'attemptCount', width: 90 },
    { title: '抑制数', dataIndex: 'suppressedCount', width: 80 },
    { title: '错误', dataIndex: 'error', width: 200, ellipsis: true, render: (v: string) => v || '-' },
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
  ];

  return (
    <div>
      <PageHeader
        title="通知记录"
        extra={(
          <>
            <Select allowClear placeholder="事件类型" style={{ width: 200 }}
              options={[
                'task_success', 'task_failed', 'task_timeout',
                'provider_error', 'provider_rate_limited', 'provider_unavailable',
                'queue_backlog_high', 'queue_stalled',
                'account_balance_low', 'account_disabled',
              ].map((t) => ({ value: t, label: t }))}
              value={params.eventType}
              onChange={(v) => setParams({ ...params, eventType: v, page: 1 })}
            />
            <Select allowClear placeholder="渠道" style={{ width: 140 }}
              options={[{ value: 'wecom', label: '企业微信' }, { value: 'email', label: '邮件' }, { value: 'in_app', label: '站内通知' }]}
              value={params.channelType}
              onChange={(v) => setParams({ ...params, channelType: v, page: 1 })}
            />
            <Select allowClear placeholder="状态" style={{ width: 120 }}
              options={[{ value: 'success', label: '成功' }, { value: 'failed', label: '失败' }, { value: 'suppressed', label: '已抑制' }]}
              value={params.status}
              onChange={(v) => setParams({ ...params, status: v, page: 1 })}
            />
            <DatePicker.RangePicker
              onChange={(dates) => {
                setParams({
                  ...params,
                  startTime: dates?.[0]?.toISOString(),
                  endTime: dates?.[1]?.toISOString(),
                  page: 1,
                });
              }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void fetchData()}>刷新</Button>
          </>
        )}
      />
      <Card>
        <Table
          columns={columns} dataSource={data.items} rowKey="_id" loading={loading} size="small" scroll={{ x: 1200 }}
          pagination={{
            current: params.page, pageSize: params.pageSize, total: data.total,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => setParams({ ...params, page: p, pageSize: ps }),
          }}
        />
      </Card>
    </div>
  );
}
