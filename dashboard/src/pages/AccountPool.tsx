import { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Button, Space, Typography, message, Modal, Form,
  Input, InputNumber, Switch, Tag, Select, Popconfirm, Tooltip, Alert,
} from 'antd';
import {
  ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { accountPoolApi, providerConfigApi } from '../services/api';

interface AccountEntry {
  _id: string;
  provider_name: string;
  account_alias: string;
  api_key: string;
  base_url?: string;
  weight: number;
  enabled: boolean;
  health_status: string;
  daily_cost_limit: number;
  monthly_cost_limit: number;
  tags: string[];
  metadata: Record<string, unknown>;
  revision: number;
  createdAt?: string;
  updatedAt?: string;
}

interface ProviderConfig {
  provider_name: string;
  enabled: boolean;
  base_url: string;
  api_key_masked: string;
  has_api_key: boolean;
  source: string;
}

const healthColorMap: Record<string, string> = {
  closed: 'success',
  'half-open': 'warning',
  open: 'error',
};

const healthLabelMap: Record<string, string> = {
  closed: '正常',
  'half-open': '半开',
  open: '熔断',
};

export default function AccountPoolPage() {
  const [items, setItems] = useState<AccountEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterProvider, setFilterProvider] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AccountEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  // Provider configs from API (for dropdown + status display)
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);

  const fetchProviderConfigs = useCallback(async () => {
    try {
      const res: any = await providerConfigApi.list();
      const d = res.data || {};
      setProviderConfigs(d.items || []);
    } catch {
      // silent — filter still works from account data
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (filterProvider) params.provider_name = filterProvider;
      const res: any = await accountPoolApi.list(params);
      const d = res.data || {};
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch {
      message.error('加载账号池失败');
    }
    setLoading(false);
  }, [page, pageSize, filterProvider]);

  useEffect(() => { void fetchProviderConfigs(); }, [fetchProviderConfigs]);
  useEffect(() => { void fetchData(); }, [fetchData]);

  // Build a map for quick provider config lookup
  const providerConfigMap = new Map(providerConfigs.map((p) => [p.provider_name, p]));

  // Provider names for filter dropdown — merge from both sources
  const providerNames = [
    ...new Set([
      ...providerConfigs.map((p) => p.provider_name),
      ...items.map((i) => i.provider_name),
    ]),
  ].sort();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ weight: 1, enabled: true, daily_cost_limit: 0, monthly_cost_limit: 0 });
    setModalOpen(true);
  };

  const openEdit = (record: AccountEntry) => {
    setEditing(record);
    form.setFieldsValue({
      provider_name: record.provider_name,
      account_alias: record.account_alias,
      api_key: '',
      base_url: record.base_url || '',
      weight: record.weight,
      enabled: record.enabled,
      daily_cost_limit: record.daily_cost_limit,
      monthly_cost_limit: record.monthly_cost_limit,
      tags: record.tags?.join(', ') || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const tags = values.tags
        ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : [];

      if (editing) {
        const body: Record<string, any> = {
          account_alias: values.account_alias,
          base_url: values.base_url || undefined,
          weight: values.weight,
          enabled: values.enabled,
          daily_cost_limit: values.daily_cost_limit,
          monthly_cost_limit: values.monthly_cost_limit,
          tags,
        };
        if (values.api_key?.trim()) body.api_key = values.api_key.trim();
        const res: any = await accountPoolApi.update(editing._id, body);
        if (res.code !== 0) { message.error(res.message || '更新失败'); return; }
        message.success('更新成功');
      } else {
        const body = {
          provider_name: values.provider_name,
          account_alias: values.account_alias,
          api_key: values.api_key,
          base_url: values.base_url || undefined,
          weight: values.weight,
          enabled: values.enabled,
          daily_cost_limit: values.daily_cost_limit,
          monthly_cost_limit: values.monthly_cost_limit,
          tags,
        };
        const res: any = await accountPoolApi.create(body);
        if (res.code !== 0) { message.error(res.message || '创建失败'); return; }
        message.success('创建成功');
      }
      setModalOpen(false);
      void fetchData();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record: AccountEntry) => {
    try {
      const res: any = await accountPoolApi.remove(record._id);
      if (res.code !== 0) { message.error(res.message || '删除失败'); return; }
      message.success('已删除');
      void fetchData();
    } catch {
      message.error('删除失败');
    }
  };

  const handleToggle = async (record: AccountEntry, enabled: boolean) => {
    try {
      const res: any = await accountPoolApi.update(record._id, { enabled });
      if (res.code !== 0) { message.error(res.message || '操作失败'); return; }
      message.success(enabled ? '已启用' : '已禁用');
      void fetchData();
    } catch {
      message.error('操作失败');
    }
  };

  // --- Task 14.2: Render provider status header for grouped display ---
  const renderProviderGroupHeader = (providerName: string) => {
    const cfg = providerConfigMap.get(providerName);
    const isDisabled = cfg && !cfg.enabled;
    return (
      <Space size="middle">
        <Typography.Text strong>{providerName}</Typography.Text>
        {cfg && (
          <>
            <Tag color={cfg.enabled ? 'success' : 'error'}>
              {cfg.enabled ? '厂商已启用' : '厂商已禁用'}
            </Tag>
            {cfg.base_url && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {cfg.base_url}
              </Typography.Text>
            )}
          </>
        )}
        {isDisabled && (
          <Tooltip title="该厂商已被禁用，其下账号可能已被自动停用">
            <WarningOutlined style={{ color: '#faad14', fontSize: 16 }} />
          </Tooltip>
        )}
      </Space>
    );
  };

  // Group items by provider for display
  const groupedByProvider = items.reduce<Record<string, AccountEntry[]>>((acc, item) => {
    (acc[item.provider_name] ||= []).push(item);
    return acc;
  }, {});
  const sortedProviders = Object.keys(groupedByProvider).sort();

  const columns = [
    { title: '别名', dataIndex: 'account_alias', width: 150 },
    { title: 'API Key', dataIndex: 'api_key', width: 120 },
    { title: 'Base URL', dataIndex: 'base_url', ellipsis: true, width: 180, render: (v: string) => v || '—' },
    {
      title: '权重', dataIndex: 'weight', width: 70, sorter: (a: AccountEntry, b: AccountEntry) => a.weight - b.weight,
    },
    {
      title: '状态', dataIndex: 'enabled', width: 80,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '启用' : '禁用'}</Tag>,
    },
    {
      title: '熔断', dataIndex: 'health_status', width: 80,
      render: (v: string) => (
        <Tag color={healthColorMap[v] || 'default'}>{healthLabelMap[v] || v}</Tag>
      ),
    },
    {
      title: '日限额', dataIndex: 'daily_cost_limit', width: 90,
      render: (v: number) => v > 0 ? `¥${v}` : '无限',
    },
    {
      title: '月限额', dataIndex: 'monthly_cost_limit', width: 90,
      render: (v: number) => v > 0 ? `¥${v}` : '无限',
    },
    {
      title: '操作', width: 200, fixed: 'right' as const,
      render: (_: unknown, record: AccountEntry) => (
        <Space size="small">
          <Tooltip title={record.enabled ? '禁用' : '启用'}>
            <Switch
              size="small"
              checked={record.enabled}
              onChange={(checked) => void handleToggle(record, checked)}
            />
          </Tooltip>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确认删除此账号？" onConfirm={() => void handleDelete(record)} okText="删除" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={<Typography.Title level={4} style={{ margin: 0 }}>账号池管理</Typography.Title>}
        extra={
          <Space>
            <Select
              placeholder="按厂商筛选" allowClear style={{ width: 180 }}
              options={providerNames.map((p) => ({ label: p, value: p }))}
              value={filterProvider}
              onChange={(v) => { setFilterProvider(v); setPage(1); }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => { void fetchData(); void fetchProviderConfigs(); }} loading={loading}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加账号</Button>
          </Space>
        }
      >
        {/* Task 14.2: Grouped display with provider status headers */}
        {sortedProviders.length === 0 && !loading && (
          <Typography.Text type="secondary">暂无账号数据</Typography.Text>
        )}
        {sortedProviders.map((providerName) => {
          const providerCfg = providerConfigMap.get(providerName);
          const isProviderDisabled = providerCfg && !providerCfg.enabled;
          return (
            <div key={providerName} style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8 }}>
                {renderProviderGroupHeader(providerName)}
              </div>
              {isProviderDisabled && (
                <Alert
                  type="warning"
                  showIcon
                  message="该厂商已被禁用，其下账号已被自动停用，启用厂商后账号将自动恢复"
                  style={{ marginBottom: 8 }}
                />
              )}
              <Table<AccountEntry>
                rowKey="_id"
                loading={loading}
                dataSource={groupedByProvider[providerName]}
                columns={columns}
                scroll={{ x: 1100 }}
                pagination={false}
                size="small"
              />
            </div>
          );
        })}
        {/* Overall pagination */}
        {total > 0 && (
          <div style={{ textAlign: 'right', marginTop: 16 }}>
            <Typography.Text type="secondary" style={{ marginRight: 16 }}>
              共 {total} 条
            </Typography.Text>
            <Space>
              <Select
                value={pageSize}
                onChange={(v) => { setPageSize(v); setPage(1); }}
                options={[
                  { label: '20 条/页', value: 20 },
                  { label: '50 条/页', value: 50 },
                  { label: '100 条/页', value: 100 },
                ]}
                style={{ width: 120 }}
              />
              <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
              <Typography.Text>第 {page} 页</Typography.Text>
              <Button disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>下一页</Button>
            </Space>
          </div>
        )}
      </Card>

      <Modal
        title={editing ? `编辑账号 — ${editing.account_alias}` : '添加账号'}
        open={modalOpen}
        onOk={() => void handleSubmit()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" preserve={false}>
          {/* Task 14.1: provider_name as Select dropdown from provider config API */}
          <Form.Item
            name="provider_name" label="厂商名称"
            rules={[{ required: true, message: '请选择厂商名称' }]}
          >
            <Select
              placeholder="请选择厂商"
              disabled={!!editing}
              showSearch
              optionFilterProp="label"
              options={providerConfigs.map((p) => ({
                label: (
                  <Space>
                    <span>{p.provider_name}</span>
                    {!p.enabled && <Tag color="error" style={{ marginRight: 0 }}>已禁用</Tag>}
                  </Space>
                ),
                value: p.provider_name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="account_alias" label="账号别名"
            rules={[{ required: true, message: '请输入账号别名' }]}
          >
            <Input placeholder="e.g. wavespeed-prod-01" />
          </Form.Item>
          <Form.Item
            name="api_key"
            label={editing ? 'API Key（留空则不修改）' : 'API Key'}
            rules={editing ? [] : [{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder={editing ? '仅更新时填写' : '请输入 API Key'} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="base_url" label="Base URL（可选）">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="weight" label="权重" rules={[{ required: true, message: '请输入权重' }]}>
            <InputNumber min={0.01} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="daily_cost_limit" label="日成本限额（0=无限制）">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="monthly_cost_limit" label="月成本限额（0=无限制）">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="tags" label="标签（逗号分隔）">
            <Input placeholder="e.g. production, high-priority" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
