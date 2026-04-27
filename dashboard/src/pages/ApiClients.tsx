import { useEffect, useState } from 'react';
import {
  Table, Card, Button, Space, Typography, Switch, message, Modal, Form, Input, InputNumber, Tag,
} from 'antd';
import { PlusOutlined, ReloadOutlined, KeyOutlined } from '@ant-design/icons';
import { apiClientApi } from '../services/api';

export default function ApiClientsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const [priorityForm] = Form.useForm();
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null);

  const fetchData = async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const res: any = await apiClientApi.list({ page: p, pageSize: ps });
      setItems(res.data?.items || []);
      setTotal(res.data?.total ?? 0);
      setPage(res.data?.page ?? p);
      setPageSize(res.data?.pageSize ?? ps);
    } catch {
      message.error('加载失败');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setCreating(true);
    try {
      const res: any = await apiClientApi.create({ name: values.name || undefined });
      const key = res.data?.apiKey;
      Modal.success({
        title: '请立即保存 API Key',
        width: 560,
        content: (
          <div>
            <Typography.Paragraph copyable={{ text: key }}><code>{key}</code></Typography.Paragraph>
            <Typography.Text type="secondary">关闭后将无法再次查看完整密钥。</Typography.Text>
          </div>
        ),
      });
      setCreateOpen(false);
      form.resetFields();
      fetchData(1, pageSize);
    } catch {
      message.error('创建失败');
    }
    setCreating(false);
  };

  const onRotate = (clientId: string) => {
    Modal.confirm({
      title: '轮换密钥？',
      content: '旧密钥将立即失效，请保存新密钥。',
      onOk: async () => {
        try {
          const res: any = await apiClientApi.rotate(clientId);
          const key = res.data?.apiKey;
          Modal.success({
            title: '新 API Key',
            width: 560,
            content: (
              <Typography.Paragraph copyable={{ text: key }}><code>{key}</code></Typography.Paragraph>
            ),
          });
          fetchData(page, pageSize);
        } catch {
          message.error('轮换失败');
        }
      },
    });
  };

  const onToggle = async (record: any, enabled: boolean) => {
    try {
      await apiClientApi.setEnabled(record.clientId, enabled);
      message.success(enabled ? '已启用' : '已禁用');
      fetchData(page, pageSize);
    } catch {
      message.error('更新失败');
    }
  };

  const onEditPriority = (record: any) => {
    setEditingClient(record);
    priorityForm.setFieldsValue({ defaultPriority: record.defaultPriority ?? 50 });
    setPriorityOpen(true);
  };

  const onSavePriority = async () => {
    const values = await priorityForm.validateFields().catch(() => null);
    if (!values || !editingClient) return;
    try {
      await apiClientApi.updateDefaultPriority(editingClient.clientId, values.defaultPriority);
      message.success('默认优先级已更新');
      setPriorityOpen(false);
      setEditingClient(null);
      fetchData(page, pageSize);
    } catch {
      message.error('更新失败');
    }
  };

  const columns = [
    { title: 'clientId', dataIndex: 'clientId', key: 'clientId', ellipsis: true, width: 260 },
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true, width: 160 },
    {
      title: '默认优先级',
      dataIndex: 'defaultPriority',
      key: 'defaultPriority',
      width: 130,
      render: (val: number | undefined) => {
        const p = val ?? 50;
        const label = p <= 33 ? '高' : p <= 66 ? '中' : '低';
        const color = p <= 33 ? 'red' : p <= 66 ? 'orange' : 'green';
        return <><Tag color={color}>{label}</Tag> {p}</>;
      },
    },
    {
      title: '启用',
      key: 'enabled',
      width: 100,
      render: (_: unknown, r: any) => (
        <Switch checked={r.enabled !== false} onChange={(v) => onToggle(r, v)} size="small" />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: unknown, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => onEditPriority(r)}>
            优先级
          </Button>
          <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => onRotate(r.clientId)}>
            轮换密钥
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="API 客户端"
      extra={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => fetchData(page, pageSize)}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建</Button>
        </Space>
      )}
    >
      <Table
        rowKey="clientId"
        columns={columns}
        dataSource={items}
        loading={loading}
        size="small"
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => fetchData(p, ps || pageSize),
        }}
      />
      <Modal
        title="新建 API 客户端"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        onOk={onCreate}
        confirmLoading={creating}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="显示名称（可选）">
            <Input placeholder="例如：AGI-Content 生产" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="编辑默认优先级"
        open={priorityOpen}
        onCancel={() => { setPriorityOpen(false); setEditingClient(null); }}
        onOk={onSavePriority}
        destroyOnClose
      >
        <Form form={priorityForm} layout="vertical">
          <Form.Item
            name="defaultPriority"
            label="默认优先级（0=最高, 100=最低）"
            rules={[{ required: true, message: '请输入优先级' }]}
          >
            <InputNumber min={0} max={100} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
