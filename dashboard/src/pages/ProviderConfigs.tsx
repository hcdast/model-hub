import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Button, Space, Typography, message, Modal, Form, Input, InputNumber, Switch, Avatar, Alert } from 'antd';
import { ReloadOutlined, EditOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import ProviderAccountPoolModal from '../components/ProviderAccountPoolModal';
import { providerConfigApi, accountPoolApi } from '../services/api';
import type { ProviderConfigItem } from '../services/api';
import { invalidateProviderOptionsCache } from '../hooks/useProviderOptions';

type PoolStat = { total: number; enabled: number };

export default function ProviderConfigsPage() {
  const [items, setItems] = useState<ProviderConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [poolStats, setPoolStats] = useState<Record<string, PoolStat>>({});
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [poolModalProvider, setPoolModalProvider] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderConfigItem | null>(null);
  const [form] = Form.useForm();

  const fetchPoolStats = useCallback(async () => {
    try {
      const map: Record<string, PoolStat> = {};
      let page = 1;
      const pageSize = 100;
      for (;;) {
        const res: any = await accountPoolApi.list({ page, pageSize });
        const d = res.data || {};
        const rows = d.items || [];
        const totalAll: number = d.total ?? 0;
        for (const row of rows) {
          const p = String(row.provider_name);
          if (!map[p]) map[p] = { total: 0, enabled: 0 };
          map[p].total += 1;
          if (row.enabled) map[p].enabled += 1;
        }
        if (page * pageSize >= totalAll || rows.length === 0) break;
        page += 1;
      }
      setPoolStats(map);
    } catch {
      setPoolStats({});
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [res] = await Promise.all([
        providerConfigApi.list(),
        fetchPoolStats(),
      ]);
      setItems(res.data?.items || []);
    } catch {
      message.error('加载供应商配置失败');
    }
    setLoading(false);
  }, [fetchPoolStats]);

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
      invalidateProviderOptionsCache();
      setModalOpen(false);
      void fetchData();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '保存失败');
    }
  };

  return (
    <div>
      <PageHeader
        title="供应商配置"
        leftExtra={(
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            添加厂商
          </Button>
        )}
        extra={(
          <Button icon={<ReloadOutlined />} onClick={() => void fetchData()} loading={loading}>
            刷新
          </Button>
        )}
      />
      <Card styles={{ body: { paddingBlock: 12, paddingInline: 16 } }}>
        <Table<ProviderConfigItem>
        rowKey="provider_name"
        loading={loading}
        dataSource={items}
        pagination={false}
        size="small"
        tableLayout="fixed"
        scroll={{ x: 1140 }}
        columns={[
          {
            title: '厂商',
            dataIndex: 'provider_name',
            width: 148,
            render: (name: string, r: ProviderConfigItem) => (
              <Space size={8}>
                {r.icon_url ? (
                  <Avatar size={24} src={r.icon_url} shape="square" />
                ) : (
                  <Avatar size={24} shape="square" style={{ backgroundColor: '#e8e8e8', color: '#999', fontSize: 12 }}>
                    {name.charAt(0).toUpperCase()}
                  </Avatar>
                )}
                <Typography.Text ellipsis={{ tooltip: name }} style={{ maxWidth: 92 }}>
                  {name}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '厂商图标 URL',
            key: 'icon_url',
            width: 220,
            render: (_, r) =>
              r.icon_url ? (
                <Typography.Text
                  copyable={{ text: r.icon_url }}
                  ellipsis={{ tooltip: r.icon_url }}
                  style={{ width: '100%', marginBottom: 0 }}
                >
                  {r.icon_url}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
          },
          {
            title: 'Base URL',
            dataIndex: 'base_url',
            width: 280,
            ellipsis: { showTitle: false },
            render: (url: string) => (
              <Typography.Text ellipsis={{ tooltip: url }} style={{ width: '100%' }}>
                {url || '—'}
              </Typography.Text>
            ),
          },
          {
            title: '并发 / QPS',
            key: 'lim',
            width: 108,
            align: 'right' as const,
            render: (_, r) => `${r.limits?.maxConcurrent ?? '—'} / ${r.limits?.maxPerSecond ?? '—'}`,
          },
          {
            title: '轮询 QPS',
            key: 'poll',
            width: 88,
            align: 'right' as const,
            render: (_, r) => r.poll_limits?.max_per_second ?? '—',
          },
          { title: 'rev', dataIndex: 'revision', width: 56, align: 'right' as const },
          {
            title: '账号池',
            key: 'account_pool',
            width: 152,
            render: (_, r) => {
              const s = poolStats[r.provider_name];
              const label = s ? `${s.total} 条（${s.enabled} 启用）` : '0 条';
              return (
                <Space size={4} wrap>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                    {label}
                  </Typography.Text>
                  <Button
                    type="link"
                    size="small"
                    icon={<TeamOutlined />}
                    onClick={() => {
                      setPoolModalProvider(r.provider_name);
                      setPoolModalOpen(true);
                    }}
                  >
                    管理
                  </Button>
                </Space>
              );
            },
          },
          {
            title: '操作',
            key: 'actions',
            width: 80,
            render: (_, r) => (
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
                编辑
              </Button>
            ),
          },
        ]}
      />

      <ProviderAccountPoolModal
        open={poolModalOpen}
        providerName={poolModalProvider}
        onClose={() => {
          setPoolModalOpen(false);
          setPoolModalProvider(null);
        }}
        onPoolChanged={() => void fetchPoolStats()}
      />

      <Modal
        title={editing ? `编辑 — ${editing.provider_name}` : '添加供应商配置'}
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
    </div>
  );
}
