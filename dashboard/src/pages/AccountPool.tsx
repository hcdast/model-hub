import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Button, Space, Typography, message, Modal, Form,
  Input, InputNumber, Switch, Tag, Select, Popconfirm, Tooltip, Alert,
  Divider,
} from 'antd';
import {
  ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  WarningOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import { accountPoolApi, providerConfigApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';
import type { ProviderConfigItem } from '../services/api';

interface AccountEntry {
  _id: string;
  provider_name: string;
  account_alias: string;
  api_key: string;
  base_url?: string;
  extra_credentials?: Record<string, unknown>;
  description?: string;
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

/**
 * 各厂商 extra_credentials 模板
 * 仅需 api_key 的厂商返回空对象，有额外认证参数的厂商返回对应字段模板
 */
const EXTRA_CREDENTIALS_TEMPLATES: Record<string, Record<string, string>> = {
  'wavespeed-ai': {},
  'cloudwise': {},
  'akool': {},
  'seedance': {},
  'alibaba': {},
  'minimax': { bizId: '' },
  'tencent-cloud': { secretId: '', secretKey: '', region: '', subAppId: '' },
};

/** 将 extra_credentials 对象转为表单用的键值对数组 */
function credentialsToFormList(creds?: Record<string, unknown>): { key: string; value: string }[] {
  if (!creds || Object.keys(creds).length === 0) return [];
  return Object.entries(creds).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : String(value ?? ''),
  }));
}

/** 将表单键值对数组转回 extra_credentials 对象 */
function formListToCredentials(list?: { key: string; value: string }[]): Record<string, string> {
  if (!list || list.length === 0) return {};
  const result: Record<string, string> = {};
  for (const item of list) {
    const k = item.key?.trim();
    if (k) result[k] = item.value ?? '';
  }
  return result;
}

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

  // 厂商配置列表（用于下拉选择和状态展示）
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfigItem[]>([]);

  const fetchProviderConfigs = useCallback(async () => {
    try {
      const res: any = await providerConfigApi.list();
      const d = res.data || {};
      setProviderConfigs(d.items || []);
    } catch {
      // 静默失败 — 筛选仍可从账号数据中获取
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
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载账号池失败');
    }
    setLoading(false);
  }, [page, pageSize, filterProvider]);

  useEffect(() => { void fetchProviderConfigs(); }, [fetchProviderConfigs]);
  useEffect(() => { void fetchData(); }, [fetchData]);

  // 快速查找厂商配置
  const providerConfigMap = new Map(providerConfigs.map((p) => [p.provider_name, p]));

  // 合并厂商名称列表（用于筛选下拉）
  const providerNames = [
    ...new Set([
      ...providerConfigs.map((p) => p.provider_name),
      ...items.map((i) => i.provider_name),
    ]),
  ].sort();

  // 检测无账号池条目的厂商（用于显示警告）
  const providersWithEntries = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add(item.provider_name);
    return set;
  }, [items]);

  const providersWithoutEntries = useMemo(() => {
    return providerConfigs
      .filter((p) => p.enabled && !providersWithEntries.has(p.provider_name))
      .map((p) => p.provider_name);
  }, [providerConfigs, providersWithEntries]);

  /** 根据选择的 provider 预填充 extra_credentials 模板 */
  const handleProviderChange = (providerName: string) => {
    const template = EXTRA_CREDENTIALS_TEMPLATES[providerName];
    if (template && Object.keys(template).length > 0) {
      form.setFieldsValue({
        extra_credentials_list: credentialsToFormList(template),
      });
    } else {
      form.setFieldsValue({ extra_credentials_list: [] });
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      weight: 1,
      enabled: true,
      daily_cost_limit: 0,
      monthly_cost_limit: 0,
      description: '',
      extra_credentials_list: [],
    });
    setModalOpen(true);
  };

  const openEdit = (record: AccountEntry) => {
    setEditing(record);
    form.setFieldsValue({
      provider_name: record.provider_name,
      account_alias: record.account_alias,
      api_key: '',
      base_url: record.base_url || '',
      description: record.description || '',
      extra_credentials_list: credentialsToFormList(record.extra_credentials),
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

      // 将键值对列表转为 extra_credentials 对象
      const extra_credentials = formListToCredentials(values.extra_credentials_list);

      if (editing) {
        const body: Record<string, any> = {
          account_alias: values.account_alias,
          base_url: values.base_url || undefined,
          description: values.description || '',
          extra_credentials,
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
          description: values.description || '',
          extra_credentials,
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
      ErrorHandler.handleApiError(err, '操作失败');
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
    } catch (err) {
      ErrorHandler.handleApiError(err, '删除失败');
    }
  };

  const handleToggle = async (record: AccountEntry, enabled: boolean) => {
    try {
      const res: any = await accountPoolApi.update(record._id, { enabled });
      if (res.code !== 0) { message.error(res.message || '操作失败'); return; }
      message.success(enabled ? '已启用' : '已禁用');
      void fetchData();
    } catch (err) {
      ErrorHandler.handleApiError(err, '操作失败');
    }
  };

  // 渲染厂商分组头部（含状态标签）
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

  // 按厂商分组展示
  const groupedByProvider = items.reduce<Record<string, AccountEntry[]>>((acc, item) => {
    (acc[item.provider_name] ||= []).push(item);
    return acc;
  }, {});
  const sortedProviders = Object.keys(groupedByProvider).sort();

  const columns = [
    { title: '别名', dataIndex: 'account_alias', width: 150 },
    { title: 'API Key', dataIndex: 'api_key', width: 120 },
    {
      title: '描述', dataIndex: 'description', width: 150, ellipsis: true,
      render: (v: string) => v || '—',
    },
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
        {/* 无账号池条目的厂商警告 */}
        {providersWithoutEntries.length > 0 && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message="以下已启用的厂商尚无账号池条目，将无法处理请求"
            description={
              <Space wrap>
                {providersWithoutEntries.map((p) => (
                  <Tag key={p} color="warning">{p}</Tag>
                ))}
              </Space>
            }
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 按厂商分组展示 */}
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
                scroll={{ x: 1200 }}
                pagination={false}
                size="small"
              />
            </div>
          );
        })}
        {/* 分页 */}
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
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false}>
          {/* 厂商选择 */}
          <Form.Item
            name="provider_name" label="厂商名称"
            rules={[{ required: true, message: '请选择厂商名称' }]}
          >
            <Select
              placeholder="请选择厂商"
              disabled={!!editing}
              showSearch
              optionFilterProp="label"
              onChange={(v: string) => { if (!editing) handleProviderChange(v); }}
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
          <Form.Item name="description" label="账号描述">
            <Input.TextArea placeholder="描述此账号的用途，如：生产环境主账号" rows={2} />
          </Form.Item>
          <Form.Item name="base_url" label="Base URL（可选）">
            <Input placeholder="https://..." />
          </Form.Item>

          {/* 扩展认证字段（extra_credentials）动态键值对 */}
          <Divider orientation="left" plain>
            <Typography.Text type="secondary">扩展认证参数（extra_credentials）</Typography.Text>
          </Divider>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
            部分厂商需要额外的认证参数（如腾讯云的 secretId/secretKey）。选择厂商后会自动预填模板字段。
          </Typography.Paragraph>
          <Form.List name="extra_credentials_list">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={[name, 'key']}
                      rules={[{ required: true, message: '请输入字段名' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="字段名 (如 secretId)" style={{ width: 180 }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'value']}
                      style={{ marginBottom: 0 }}
                    >
                      <Input.Password
                        placeholder="字段值"
                        style={{ width: 280 }}
                        autoComplete="new-password"
                      />
                    </Form.Item>
                    <MinusCircleOutlined
                      onClick={() => remove(name)}
                      style={{ color: '#ff4d4f', cursor: 'pointer' }}
                    />
                  </Space>
                ))}
                <Form.Item style={{ marginBottom: 8 }}>
                  <Button type="dashed" onClick={() => add({ key: '', value: '' })} block icon={<PlusOutlined />}>
                    添加认证参数
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>

          <Divider />

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
