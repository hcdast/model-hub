import { useState } from 'react';
import { Table, Card, Input, Typography, Space, Tag } from 'antd';
import { auditApi } from '../services/api';
import { useRequest } from '../hooks/useRequest';

export default function AuditLogsPage() {
  const [params, setParams] = useState({ page: 1, pageSize: 20, action: undefined as string | undefined });

  // 使用 useRequest 替代手动 loading/data/fetchData 模式
  const { data, loading } = useRequest(
    () => auditApi.list(params).then((res: any) => res.data || { items: [], total: 0 }),
    { deps: [params.page, params.action] },
  );

  const columns = [
    { title: '操作类型', dataIndex: 'action', width: 180, render: (v: string) => <Tag color="orange">{v}</Tag> },
    { title: '操作人', dataIndex: 'operator', width: 120 },
    { title: '详情', dataIndex: 'detail', ellipsis: true, render: (v: any) => v ? JSON.stringify(v) : '-' },
    { title: 'IP', dataIndex: 'ip', width: 140 },
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
  ];

  return (
    <div>
      <Typography.Title level={4}>审计日志</Typography.Title>
      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Input.Search placeholder="按操作类型搜索" allowClear style={{ width: 240 }}
            onSearch={(v) => setParams({ ...params, action: v || undefined, page: 1 })} />
        </Space>
        <Table
          columns={columns} dataSource={data?.items || []} rowKey="_id" loading={loading} size="small"
          pagination={{ current: params.page, pageSize: params.pageSize, total: data?.total || 0, showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => setParams({ ...params, page: p, pageSize: ps }),
          }}
        />
      </Card>
    </div>
  );
}
