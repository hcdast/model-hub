import { useEffect, useState } from 'react';
import { Card, Table, Form, Input, Select, Button, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { callbackLogApi } from '../services/api';
import { formatDateTime } from '../utils/format-helpers';
import PageHeader from '../components/PageHeader';

export default function CallbackLogsPage() {
  const [form] = Form.useForm();
  const [data, setData] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchData = async (p: number, ps: number) => {
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const res: any = await callbackLogApi.list({
        taskId: values.taskId || undefined,
        success: values.success,
        responseCode: values.responseCode || undefined,
        from: values.from || undefined,
        to: values.to || undefined,
        page: p,
        pageSize: ps,
      });
      setData(res.data || { items: [], total: 0 });
    } catch {
      setData({ items: [], total: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(1, 20);
  }, []);

  const columns = [
    { title: 'TaskId', dataIndex: 'taskId', width: 200, ellipsis: true },
    { title: 'URL', dataIndex: 'callbackUrl', ellipsis: true },
    { title: '次数', dataIndex: 'attempt', width: 70 },
    {
      title: '结果',
      dataIndex: 'success',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="success">成功</Tag> : <Tag color="error">失败</Tag>),
    },
    { title: 'HTTP', dataIndex: 'responseCode', width: 80, render: (v: number) => v ?? '—' },
    { title: '耗时(ms)', dataIndex: 'latencyMs', width: 90, render: (v: number) => v ?? '—' },
    { title: '错误', dataIndex: 'error', ellipsis: true, render: (v: string) => v || '—' },
    { title: '时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
  ];

  return (
    <div>
      <PageHeader
        title="回调投递日志"
        subtitle="与任务详情中的「重放回调」配合排查；数据约保留 30 天（TTL）。"
      />
      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={() => { setPage(1); fetchData(1, pageSize); }}>
          <Form.Item name="taskId" label="TaskId">
            <Input placeholder="可选" allowClear style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="success" label="结果">
            <Select allowClear placeholder="全部" style={{ width: 100 }} options={[{ value: 'true', label: '成功' }, { value: 'false', label: '失败' }]} />
          </Form.Item>
          <Form.Item name="responseCode" label="HTTP">
            <Input placeholder="如 200" allowClear style={{ width: 90 }} />
          </Form.Item>
          <Form.Item name="from" label="从">
            <Input placeholder="ISO 时间" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="to" label="至">
            <Input placeholder="ISO 时间" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">查询</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { form.resetFields(); setPage(1); fetchData(1, pageSize); }}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          提示：时间筛选请使用 ISO 格式，例如 2026-05-01T00:00:00.000Z
        </Typography.Text>
      </Card>
      <Card>
        <Table
          rowKey={(r) => `${r.taskId}-${r.attempt}-${r.createdAt}`}
          columns={columns}
          dataSource={data.items}
          loading={loading}
          size="small"
          scroll={{ x: 1200 }}
          pagination={{
            current: page,
            pageSize,
            total: data.total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
              fetchData(p, ps);
            },
          }}
        />
      </Card>
    </div>
  );
}
