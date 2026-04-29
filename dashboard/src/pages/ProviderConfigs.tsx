import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Button, Space, Typography, message, Modal, Form, Input, InputNumber, Switch, Avatar } from 'antd';
import { ReloadOutlined, EditOutlined } from '@ant-design/icons';
import { providerConfigApi } from '../services/api';

interface Row {
  provider_name: string;
  enabled: boolean;
  icon_url: string;
  base_url: string;
  api_key_masked: string;
  has_api_key: boolean;
  limits: { maxConcurrent?: number; maxPerSecond?: number; maxPerMinute?: number };
  poll_limits: { max_per_second?: number; max_concurrent?: number };
  revision: number;
  updatedAt?: string;
  extra?: Record<string, unknown>;
}

export default function ProviderConfigsPage() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
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

  const openEdit = async (r: Row) => {
    setEditing(r);
    // 获取详情以获取 extra 字段
    try {
      const detail: any = await providerConfigApi.get(r.provider_name);
      const detailData = detail.data || {};
      form.setFieldsValue({
        enabled: detailData.enabled ?? r.enabled,
        icon_url: detailData.icon_url ?? r.icon_url ?? '',
        base_url: detailData.base_url ?? r.base_url,
        api_key: '',
        max_concurrent: r.limits?.maxConcurrent,
        max_per_second: r.limits?.maxPerSecond,
        max_per_minute: r.limits?.maxPerMinute,
        poll_max_per_second: r.poll_limits?.max_per_second,
        poll_max_concurrent: r.poll_limits?.max_concurrent,
        // Tencent Cloud 特殊字段
        subAppId: detailData.extra?.subAppId || '',
        secretId: detailData.extra?.secretId || '',
        secretKey: detailData.extra?.secretKey || '',
        region: detailData.extra?.region || '',
      });
    } catch {
      form.setFieldsValue({
        enabled: r.enabled,
        icon_url: r.icon_url || '',
        base_url: r.base_url,
        api_key: '',
        max_concurrent: r.limits?.maxConcurrent,
        max_per_second: r.limits?.maxPerSecond,
        max_per_minute: r.limits?.maxPerMinute,
        poll_max_per_second: r.poll_limits?.max_per_second,
        poll_max_concurrent: r.poll_limits?.max_concurrent,
      });
    }
    setModalOpen(true);
  };

  const submit = async () => {
    if (!editing) return;
    try {
      const v = await form.validateFields();
      const limits: Record<string, number> = {};
      if (v.max_concurrent != null) limits.max_concurrent = v.max_concurrent;
      if (v.max_per_second != null) limits.max_per_second = v.max_per_second;
      if (v.max_per_minute != null) limits.max_per_minute = v.max_per_minute;
      const poll_limits: Record<string, number> = {};
      if (v.poll_max_per_second != null) poll_limits.max_per_second = v.poll_max_per_second;
      if (v.poll_max_concurrent != null) poll_limits.max_concurrent = v.poll_max_concurrent;

      // 构建 extra 字段（仅 tencent-cloud 需要）
      const extra: Record<string, unknown> = {};
      if (editing.provider_name === 'tencent-cloud') {
        if (v.subAppId?.trim()) extra.subAppId = v.subAppId.trim();
        if (v.secretId?.trim()) extra.secretId = v.secretId.trim();
        if (v.secretKey?.trim()) extra.secretKey = v.secretKey.trim();
        if (v.region?.trim()) extra.region = v.region.trim();
      }

      await providerConfigApi.upsert(editing.provider_name, {
        enabled: v.enabled,
        icon_url: v.icon_url?.trim() || '',
        base_url: v.base_url,
        api_key: v.api_key?.trim() ? v.api_key.trim() : undefined,
        limits: Object.keys(limits).length ? limits : undefined,
        poll_limits: Object.keys(poll_limits).length ? poll_limits : undefined,
        extra: Object.keys(extra).length ? extra : undefined,
      });
      message.success('已保存');
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
        <Button icon={<ReloadOutlined />} onClick={() => void fetchData()} loading={loading}>
          刷新
        </Button>
      )}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        厂商连接信息与限流均来自 MongoDB 集合 <code>provider_runtime_configs</code>；密钥仅展示脱敏，更新时仅在输入框填写新密钥才会覆盖。未落库前使用服务内建默认 base_url 与限流。
      </Typography.Paragraph>
      <Table<Row>
        rowKey="provider_name"
        loading={loading}
        dataSource={items}
        pagination={false}
        columns={[
          {
            title: '厂商',
            dataIndex: 'provider_name',
            width: 180,
            render: (name: string, r: Row) => (
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
          { title: '密钥', dataIndex: 'api_key_masked', width: 120 },
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
        title={`编辑 — ${editing?.provider_name || ''}`}
        open={modalOpen}
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="enabled" label="启用（DB 行）" valuePropName="checked">
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
          <Form.Item name="api_key" label="API Key（留空则不修改）">
            <Input.Password placeholder="仅更新时填写" autoComplete="new-password" />
          </Form.Item>
          
          {editing?.provider_name === 'tencent-cloud' && (
            <>
              <Typography.Text type="secondary">腾讯云特殊配置</Typography.Text>
              <Form.Item name="subAppId" label="Sub App ID">
                <Input placeholder="1500057761" />
              </Form.Item>
              <Form.Item name="secretId" label="Secret ID">
                <Input placeholder="AKIDT..." />
              </Form.Item>
              <Form.Item name="secretKey" label="Secret Key（留空则不修改）">
                <Input.Password placeholder="仅更新时填写" />
              </Form.Item>
              <Form.Item name="region" label="Region">
                <Input placeholder="ap-guangzhou" />
              </Form.Item>
            </>
          )}

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
