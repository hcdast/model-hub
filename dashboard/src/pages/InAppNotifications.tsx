import { useEffect, useState } from 'react';
import { Table, Card, Tag, Button, Select, message, Badge } from 'antd';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { inAppNotificationApi } from '../services/api';
import { usePermission } from '../hooks/usePermission';

const severityColor: Record<string, string> = { info: 'blue', warning: 'orange', critical: 'red' };

export default function InAppNotificationsPage() {
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('notification:update');
  const [data, setData] = useState<any>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, pageSize: 20 });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [res, countRes]: any[] = await Promise.all([
        inAppNotificationApi.list(params),
        inAppNotificationApi.unreadCount(),
      ]);
      setData(res.data || { items: [], total: 0 });
      setUnread(countRes.data?.count || 0);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [params]);

  const handleMarkRead = async (id: string) => {
    try {
      await inAppNotificationApi.markRead(id);
      fetchData();
    } catch { message.error('操作失败'); }
  };

  const handleMarkAllRead = async () => {
    try {
      await inAppNotificationApi.markAllRead();
      message.success('已全部标记为已读');
      fetchData();
    } catch { message.error('操作失败'); }
  };

  const columns = [
    { title: '标题', dataIndex: 'title', width: 240, render: (v: string, record: any) => record.read ? v : <strong>{v}</strong> },
    { title: '事件类型', dataIndex: 'eventType', width: 180, render: (v: string) => <Tag>{v}</Tag> },
    { title: '严重级别', dataIndex: 'severity', width: 100, render: (v: string) => <Tag color={severityColor[v]}>{v}</Tag> },
    { title: '内容', dataIndex: 'message', ellipsis: true },
    { title: '状态', dataIndex: 'read', width: 80, render: (v: boolean) => v ? <Tag>已读</Tag> : <Tag color="blue">未读</Tag> },
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
    {
      title: '操作', width: 80, render: (_: any, record: any) =>
        canUpdate && !record.read ? <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleMarkRead(record._id)}>已读</Button> : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="站内通知"
        leftExtra={(
          <>
            {unread > 0 ? <Badge count={unread} /> : null}
            <Button onClick={handleMarkAllRead} disabled={unread === 0 || !canUpdate}>全部标记已读</Button>
          </>
        )}
        extra={(
          <>
            <Select allowClear placeholder="阅读状态" style={{ width: 140 }}
              options={[{ value: 'false', label: '未读' }, { value: 'true', label: '已读' }]}
              value={params.read}
              onChange={(v) => setParams({ ...params, read: v, page: 1 })}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void fetchData()}>刷新</Button>
          </>
        )}
      />
      <Card>
        <Table
          columns={columns} dataSource={data.items} rowKey="_id" loading={loading} size="small" scroll={{ x: 1000 }}
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
