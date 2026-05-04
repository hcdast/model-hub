import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Button, Space, Typography, message, Modal, Form, Input, InputNumber, Switch, Avatar, Alert } from 'antd';
import { ReloadOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { providerConfigApi } from '../services/api';
import type { ProviderConfigItem } from '../services/api';

export default function ProviderConfigsPage() {
  const [items, setItems] = useState<ProviderConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderConfigItem | null>(null);
  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await providerConfigApi.list();
      setItems(res.data?.items || []);
    } catch {
      message.error('加载厂商配置失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openEdit = async (r: ProviderConfigItem) => {
    setEditing(r);
    try {
      const detail: any = await providerConfigApi.get(r.provider_name);
      const detailData = detail.data || {};
      form.setFieldsValue({
        provider_name: r.provider_name,
        enabled: detailData.enabled ?? r.enabled,
        icon_url: detailData.icon_url ?? r.icon_url ?? '',
        base_url: detailData.base_url ?? r.base_url,
        max_concurrent: r.limits?.maxConcurrent,
        max_per_second: r.limits?.maxPerSecond,
        max_per_minute: r.limits?.maxPerMinute,
        poll_max_per_second: r.poll_limits?.max_per_second,
        poll_max_concurrent: r.poll_limits?.max_concurrent,
      });
    } catch {
      form.setFieldsValue({
        provider_name: r.provider_name,
        enabled: r.enabled,
        icon_url: r.icon_url || '',
        base_url: r.base_url,
        max_concurrent: r.limits?.maxConcurrent,
        max_per_second: r.limits?.maxPerSecond,
        max_per_minute: r.limits?.maxPerMinute,
        poll_max_per_second: r.poll_limits?.max_per_second,
        poll_max_concurrent: r.poll_limits?.max_concurrent,
      });
    }
    setModalOpen(true);
  };

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const v = await form.validateFields();
      const providerName = v.provider_name?.trim();
      if (!providerName) {
        message.warning('请输入厂商名称');
        return;
      }
      const limits: Record<string, number> = {};
      if (v.max_concurrent != null) limits.max_concurrent = v.max_concurrent;
      if (v.max_per_second != null) limits.max_per_second = v.max_per_second;
      if (v.max_per_minute != null) limits.max_per_minute = v.max_per_minute;
      const poll_limits: Record<string, number> = {};
      if (v.poll_max_per_second != null) poll_limits.max_per_second = v.poll_max_per_second;
      if (v.poll_max_concurrent != null) poll_limits.max_concurrent = v.poll_max_concurrent;

      await providerConfigApi.upsert(providerName, {
        enabled: v.enabled,
        icon_url: v.icon_url?.trim() || '',
        base_url: v.base_url,
        limits: Object.keys(limits).length ? limits : undefined,
        poll_limits: Object.keys(poll_limits).length ? poll_limits : undefined,
      });
      message.success(editing ? '已保存' : '已添加');
      setModalOpen(false);
      void fetchData();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '保存失败');
    }
  };

  return (
    <Card
      title={
        <Typography.Title level={4} style={{ margin: 0 }}>厂商运行时配置</Typography.Title>
      }
      extra={(
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            添加厂商
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchData()} loading={loading}>
            刷新
          </Button>
        </Space>
      )}
    >
      <Table<ProviderConfigItem>
        rowKey="provider_name"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          {
            title: '厂商',
            dataIndex: 'provider_name',
            width: 180,
            render: (name: string, r: ProviderConfigItem) => (
              <Space>
                {r.icon_url ? (
                  <Avatar size={24} src={r.icon_url} shape="square" />
                ) : (
                  <Avatar size={24} shape="square" style={{ backgroundColor: '#e8e8e8', color: '#999', fontSize: 12 }}>
                    {name.charAt(0).toUpperCase()}
                  </Avatar>
                )}
                <span>{name}</span>
              </Space>
            ),
          },
          { title: 'base_url', dataIndex: 'base_url', ellipsis: true },
          {
            title: '并发 / QPS',
            key: 'lim',
            width: 160,
            render: (_, r) => `${r.limits?.maxConcurrent ?? '—'} / ${r.limits?.maxPerSecond ?? '—'}`,
          },
          {
            title: '轮询 QPS',
            key: 'poll',
            width: 100,
            render: (_, r) => r.poll_limits?.max_per_second ?? '—',
          },
          { title: 'rev', dataIndex: 'revision', width: 70 },
          {
            title: '操作',
            width: 100,
            render: (_, r) => (
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                编辑
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? `编辑 — ${editing.provider_name}` : '添加厂商配置'}
        open={modalOpen}
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="provider_name"
            label="厂商名称"
            rules={[{ required: true, message: '请输入厂商名称' }]}
          >
            <Input
              placeholder="例如：wavespeed-ai、openai"
              disabled={!!editing}
            />
          </Form.Item>
          <Alert
            message="密钥请在「账号池」页面管理"
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="icon_url" label="厂商图标 URL">
            <Input placeholder="https://example.com/icon.png" />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.icon_url !== cur.icon_url}
          >
            {({ getFieldValue }) => {
              const url = getFieldValue('icon_url');
              return url ? (
                <div style={{ marginBottom: 16 }}>
                  <Typography.Text type="secondary" style={{ marginRight: 8 }}>预览：</Typography.Text>
                  <Avatar size={32} src={url} shape="square" />
                </div>
              ) : null;
            }}
          </Form.Item>
          <Form.Item name="base_url" label="Base URL">
            <Input placeholder="https://..." />
          </Form.Item>

          <Typography.Text type="secondary">Submit 限流</Typography.Text>
          <Form.Item name="max_concurrent" label="max_concurrent">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="max_per_second" label="max_per_second">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="max_per_minute" label="max_per_minute">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary">轮询限流（可选，未填则与 submit QPS 对齐）</Typography.Text>
          <Form.Item name="poll_max_per_second" label="poll max_per_second">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="poll_max_concurrent" label="poll max_concurrent">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
