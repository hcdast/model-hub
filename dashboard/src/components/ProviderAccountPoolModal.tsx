import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Table,
  Button,
  Space,
  Typography,
  message,
  Form,
  Input,
  InputNumber,
  Switch,
  Tag,
  Popconfirm,
  Tooltip,
  Divider,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import { accountPoolApi, providerConfigApi } from '../services/api';
import type { AccountPoolEntryItem, ProviderConfigItem } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';

type AccountEntry = AccountPoolEntryItem;

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

const EXTRA_CREDENTIALS_TEMPLATES: Record<string, Record<string, string>> = {
  'wavespeed-ai': {},
  cloudwise: {},
  akool: {},
  seedance: {},
  alibaba: {},
  minimax: { bizId: '' },
  'tencent-cloud': { secretId: '', secretKey: '', region: '', subAppId: '' },
};

function credentialsToFormList(creds?: Record<string, unknown>): { key: string; value: string }[] {
  if (!creds || Object.keys(creds).length === 0) return [];
  return Object.entries(creds).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : String(value ?? ''),
  }));
}

function formListToCredentials(list?: { key: string; value: string }[]): Record<string, string> {
  if (!list || list.length === 0) return {};
  const result: Record<string, string> = {};
  for (const item of list) {
    const k = item.key?.trim();
    if (k) result[k] = item.value ?? '';
  }
  return result;
}

export interface ProviderAccountPoolModalProps {
  open: boolean;
  providerName: string | null;
  onClose: () => void;
  /** 账号池有变更时通知父级刷新汇总 */
  onPoolChanged?: () => void;
}

export default function ProviderAccountPoolModal({
  open,
  providerName,
  onClose,
  onPoolChanged,
}: ProviderAccountPoolModalProps) {
  const [items, setItems] = useState<AccountEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editing, setEditing] = useState<AccountEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [vendorCfg, setVendorCfg] = useState<ProviderConfigItem | null>(null);

  const fetchVendor = useCallback(async (name: string) => {
    try {
      const res: any = await providerConfigApi.get(name);
      setVendorCfg(res.data || null);
    } catch {
      setVendorCfg(null);
    }
  }, []);

  const fetchList = useCallback(async () => {
    if (!providerName) return;
    setLoading(true);
    try {
      const res: any = await accountPoolApi.list({
        provider_name: providerName,
        page,
        pageSize,
      });
      const d = res.data || {};
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载账号池失败');
    }
    setLoading(false);
  }, [providerName, page, pageSize]);

  useEffect(() => {
    if (!open) setFormModalOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open || !providerName) return;
    setPage(1);
    void fetchVendor(providerName);
  }, [open, providerName, fetchVendor]);

  useEffect(() => {
    if (!open || !providerName) return;
    void fetchList();
  }, [open, providerName, fetchList]);

  const handleProviderChange = (name: string) => {
    const template = EXTRA_CREDENTIALS_TEMPLATES[name];
    if (template && Object.keys(template).length > 0) {
      form.setFieldsValue({
        extra_credentials_list: credentialsToFormList(template),
      });
    } else {
      form.setFieldsValue({ extra_credentials_list: [] });
    }
  };

  const openCreate = () => {
    if (!providerName) return;
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      provider_name: providerName,
      weight: 1,
      enabled: true,
      daily_cost_limit: 0,
      monthly_cost_limit: 0,
      description: '',
      extra_credentials_list: [],
    });
    handleProviderChange(providerName);
    setFormModalOpen(true);
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
    setFormModalOpen(true);
  };

  const notifyChanged = () => {
    onPoolChanged?.();
    void fetchList();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const tags = values.tags
        ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : [];
      const extra_credentials = formListToCredentials(values.extra_credentials_list);

      if (editing) {
        const body: Record<string, unknown> = {
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
        if (res.code !== 0) {
          message.error(res.message || '更新失败');
          return;
        }
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
        if (res.code !== 0) {
          message.error(res.message || '创建失败');
          return;
        }
        message.success('创建成功');
      }
      setFormModalOpen(false);
      notifyChanged();
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown };
      if (e?.errorFields) return;
      ErrorHandler.handleApiError(err, '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record: AccountEntry) => {
    try {
      const res: any = await accountPoolApi.remove(record._id);
      if (res.code !== 0) {
        message.error(res.message || '删除失败');
        return;
      }
      message.success('已删除');
      notifyChanged();
    } catch (err) {
      ErrorHandler.handleApiError(err, '删除失败');
    }
  };

  const handleToggle = async (record: AccountEntry, enabled: boolean) => {
    try {
      const res: any = await accountPoolApi.update(record._id, { enabled });
      if (res.code !== 0) {
        message.error(res.message || '操作失败');
        return;
      }
      message.success(enabled ? '已启用' : '已禁用');
      notifyChanged();
    } catch (err) {
      ErrorHandler.handleApiError(err, '操作失败');
    }
  };

  const displayItems = useMemo(
    () =>
      [...items].sort((a, b) => a.account_alias.localeCompare(b.account_alias)),
    [items],
  );

  const showAccountBaseUrlCol = useMemo(
    () => displayItems.some((i) => !!(i.base_url && String(i.base_url).trim())),
    [displayItems],
  );

  const columns: ColumnsType<AccountEntry> = useMemo(
    () => [
      { title: '别名', dataIndex: 'account_alias', width: 140, ellipsis: true },
      { title: 'API Key', dataIndex: 'api_key', width: 112, ellipsis: true },
      {
        title: '描述',
        dataIndex: 'description',
        width: 140,
        ellipsis: { showTitle: false },
        render: (v: string) => {
          if (!v) return <Typography.Text type="secondary">—</Typography.Text>;
          return (
            <Tooltip title={v} placement="topLeft">
              <span>{v}</span>
            </Tooltip>
          );
        },
      },
      ...(showAccountBaseUrlCol
        ? [
            {
              title: '账号 Base URL',
              dataIndex: 'base_url' as const,
              ellipsis: true,
              width: 140,
              render: (v: string) => {
                const s = v?.trim();
                if (!s) return <Typography.Text type="secondary">—</Typography.Text>;
                return (
                  <Tooltip title={s} placement="topLeft">
                    <span>{s}</span>
                  </Tooltip>
                );
              },
            },
          ]
        : []),
      {
        title: '权重',
        dataIndex: 'weight',
        width: 72,
        sorter: (a, b) => a.weight - b.weight,
      },
      {
        title: '状态',
        dataIndex: 'enabled',
        width: 72,
        render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '启用' : '禁用'}</Tag>,
      },
      {
        title: '熔断',
        dataIndex: 'health_status',
        width: 72,
        render: (v: string) => (
          <Tag color={healthColorMap[v] || 'default'}>{healthLabelMap[v] || v}</Tag>
        ),
      },
      {
        title: '成本限额',
        key: 'cost_limits',
        width: 120,
        render: (_: unknown, r: AccountEntry) => {
          const d = r.daily_cost_limit > 0;
          const m = r.monthly_cost_limit > 0;
          if (!d && !m) {
            return <Typography.Text type="secondary">—</Typography.Text>;
          }
          const parts: string[] = [];
          if (d) parts.push(`日 ¥${r.daily_cost_limit}`);
          if (m) parts.push(`月 ¥${r.monthly_cost_limit}`);
          return <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{parts.join(' · ')}</span>;
        },
      },
      {
        title: '操作',
        width: 188,
        fixed: 'right' as const,
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
            <Popconfirm
              title="确认删除此账号？"
              onConfirm={() => void handleDelete(record)}
              okText="删除"
              cancelText="取消"
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [showAccountBaseUrlCol, handleToggle, handleDelete, openEdit],
  );

  const vendorDisabled = vendorCfg && !vendorCfg.enabled;

  return (
    <>
      <Modal
        title={providerName ? `账号池 — ${providerName}` : '账号池'}
        open={open && !!providerName}
        onCancel={onClose}
        footer={null}
        width={Math.min(1100, typeof window !== 'undefined' ? window.innerWidth - 48 : 1100)}
        destroyOnClose
        styles={{ body: { paddingTop: 12 } }}
      >
        {vendorDisabled && (
          <Typography.Paragraph type="warning" style={{ marginBottom: 12 }}>
            该厂商已在运行时配置中禁用，其下账号可能已被同步停用。
          </Typography.Paragraph>
        )}
        <Space style={{ marginBottom: 12 }} wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加账号
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void fetchList()} loading={loading}>
            刷新
          </Button>
          <Typography.Text type="secondary">
            共 {total} 条账号
          </Typography.Text>
        </Space>
        <Table<AccountEntry>
          rowKey="_id"
          loading={loading}
          dataSource={displayItems}
          columns={columns}
          scroll={{ x: showAccountBaseUrlCol ? 980 : 840 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          size="small"
        />
      </Modal>

      <Modal
        title={editing ? `编辑账号 — ${editing.account_alias}` : '添加账号'}
        open={formModalOpen}
        onOk={() => void handleSubmit()}
        onCancel={() => setFormModalOpen(false)}
        confirmLoading={submitting}
        destroyOnClose
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="provider_name" label="厂商名称" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="厂商名称">
            <Typography.Text strong>{providerName}</Typography.Text>
          </Form.Item>
          <Form.Item
            name="account_alias"
            label="账号别名"
            rules={[{ required: true, message: '请输入账号别名' }]}
          >
            <Input placeholder="e.g. wavespeed-prod-01" />
          </Form.Item>
          <Form.Item
            name="api_key"
            label={editing ? 'API Key（留空则不修改）' : 'API Key'}
            rules={editing ? [] : [{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password
              placeholder={editing ? '仅更新时填写' : '请输入 API Key'}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item name="description" label="账号描述">
            <Input.TextArea placeholder="描述此账号的用途" rows={2} />
          </Form.Item>
          <Form.Item name="base_url" label="Base URL（可选）">
            <Input placeholder="https://..." />
          </Form.Item>

          <Divider orientation="left" plain>
            <Typography.Text type="secondary">扩展认证参数（extra_credentials）</Typography.Text>
          </Divider>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
            部分厂商需要额外的认证参数。当前厂商已按模板预填可编辑。
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
                      <Input placeholder="字段名" style={{ width: 180 }} />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, 'value']} style={{ marginBottom: 0 }}>
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
            <Input placeholder="e.g. production" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
