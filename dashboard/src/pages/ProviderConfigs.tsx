import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Button, Space, Typography, message, Modal, Form, Input, InputNumber, Switch, Avatar, Alert, Select, Tooltip, Drawer, Descriptions, Tag } from 'antd';
import { ReloadOutlined, EditOutlined, PlusOutlined, TeamOutlined, DeleteOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import ProviderAccountPoolModal from '../components/ProviderAccountPoolModal';
import { providerConfigApi, accountPoolApi } from '../services/api';
import type { ProviderConfigItem } from '../services/api';
import { invalidateProviderOptionsCache } from '../hooks/useProviderOptions';
import { usePermission } from '../hooks/usePermission';
import { providerConfigErrorMessage as actionError, validateLlmBaseUrl, providerConfigForm, mergeProviderConfigForm } from '../utils/provider-config';

type PoolStat = { total: number; enabled: number };

export default function ProviderConfigsPage() {
  const [readiness, setReadiness] = useState<any>();
  const [checking, setChecking] = useState(false);
  const inspect = async (name: string) => { setChecking(true); try { const r: any = await providerConfigApi.readiness(name); setReadiness(r.data); } catch (e: any) { message.error(e.message); } finally { setChecking(false); } };
  const [items, setItems] = useState<ProviderConfigItem[]>([]);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [busyProviders, setBusyProviders] = useState<Record<string, boolean>>({});
  const { hasPermission } = usePermission();
  const canUpdate = hasPermission('provider:update');
  const canDelete = hasPermission('provider:delete');
  const [loading, setLoading] = useState(false);
  const [poolStats, setPoolStats] = useState<Record<string, PoolStat>>({});
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [poolModalProvider, setPoolModalProvider] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderConfigItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ message: string; needsReload?: boolean } | null>(null);
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
      setAvailableProviders(res.data?.available_providers || []);
    } catch {
      message.error('加载供应商配置失败');
    }
    setLoading(false);
  }, [fetchPoolStats]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openEdit = async (r: ProviderConfigItem) => {
    try {
      const detail: any = await providerConfigApi.get(r.provider_name);
      const current = { ...r, ...detail.data } as ProviderConfigItem;
      setEditing(current);
      form.resetFields();
      form.setFieldsValue(providerConfigForm(current));
      setSaveNotice(null);
      setModalOpen(true);
    } catch (error) {
      message.error(actionError(error, '读取最新配置失败，请重试'));
    }
  };

  const openAdd = () => {
    setEditing(null);
    setSaveNotice(null);
    form.resetFields();
    form.setFieldsValue({ enabled: true });
    setModalOpen(true);
  };

  const submit = async () => {
    if (saving || saveNotice?.needsReload) return;
    let submitted: Record<string, any> | undefined;
    setSaving(true);
    try {
      const v = await form.validateFields();
      submitted = v;
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
        expected_revision: editing?.revision || 0,
        enabled: v.enabled,
        icon_url: v.icon_url?.trim() || '',
        base_url: v.base_url,
        ...(providerName === 'akool-maas' && v.llm_base_url !== undefined ? { llm_base_url: v.llm_base_url.trim() } : {}),
        limits: Object.keys(limits).length ? limits : undefined,
        poll_limits: Object.keys(poll_limits).length ? poll_limits : undefined,
      });
      message.success(editing ? '已保存' : '已添加');
      invalidateProviderOptionsCache();
      setModalOpen(false);
      void fetchData();
    } catch (e: any) {
      if (e?.errorFields) return;
      if (e?.response?.status === 409 && editing && submitted) {
        try {
          const response: any = await providerConfigApi.get(editing.provider_name);
          const latest = response.data as ProviderConfigItem;
          const result = mergeProviderConfigForm(providerConfigForm(editing), submitted, providerConfigForm(latest));
          if (result.conflicts.length) {
            setSaveNotice({ message: '配置已被其他操作更新，且与你修改的字段冲突。当前输入已保留，未覆盖服务器配置。可先记录修改，再点击“放弃当前修改并加载最新配置”。', needsReload: true });
          } else {
            setEditing(latest);
            form.setFieldsValue(result.values);
            setSaveNotice({ message: '配置版本已更新。已同步服务器的其他修改并保留你的输入，请核对后再次点击确定保存。' });
          }
        } catch {
          setSaveNotice({ message: '配置已更新，但读取最新版本失败。当前输入已保留，请稍后重新加载最新配置。', needsReload: true });
        }
        return;
      }
      message.error(actionError(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const setEnabled = async (record: ProviderConfigItem, enabled: boolean) => {
    const name = record.provider_name;
    setBusyProviders(prev => ({ ...prev, [name]: true }));
    try {
      const result: any = await providerConfigApi.setEnabled(name, enabled, record.revision || 0);
      if (result.code !== 0) throw new Error(result.message || '更新供应商状态失败');
      invalidateProviderOptionsCache();
      message.success(`已${enabled ? '启用' : '停用'} ${name}`);
      await fetchData();
    } catch (error: any) {
      message.error(actionError(error, '更新供应商状态失败'));
    } finally {
      setBusyProviders(prev => ({ ...prev, [name]: false }));
    }
  };

  const confirmDelete = (record: ProviderConfigItem) => {
    const name = record.provider_name;
    Modal.confirm({
      title: `删除供应商配置 ${name}？`,
      content: '若仍有关联模型、账号、路由或未结束任务，将无法删除。删除后可通过“添加厂商”重新配置。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBusyProviders(prev => ({ ...prev, [name]: true }));
        try {
          const result: any = await providerConfigApi.remove(name);
          if (result.code !== 0) throw new Error(result.message || '删除供应商配置失败');
          invalidateProviderOptionsCache();
          message.success(`已删除 ${name}`);
          await fetchData();
        } catch (error: any) {
          message.error(actionError(error, '删除供应商配置失败'));
          throw error;
        } finally {
          setBusyProviders(prev => ({ ...prev, [name]: false }));
        }
      },
    });
  };

  return (
    <div>
      <Drawer open={!!readiness} onClose={() => setReadiness(undefined)} width={640} title={`${readiness?.provider || ''} 配置就绪与依赖`}>
        {readiness && <><Alert type={readiness.warnings.length ? 'warning' : 'success'} message={readiness.warnings.join('；') || '本地配置检查通过'} description={readiness.scope} />
          <Descriptions column={1} bordered size="small" style={{ marginTop: 16 }} items={[
            { key: 'adapter', label: '适配器', children: '已注册' }, { key: 'accounts', label: '账号池', children: `${readiness.activeAccounts} 启用 / ${readiness.accounts} 总计` }, { key: 'models', label: '模型', children: readiness.models }, { key: 'routes', label: '路由', children: readiness.routes }, { key: 'tasks', label: '未结束任务', children: readiness.activeTasks }, { key: 'delete', label: '删除条件', children: readiness.canDelete ? '满足' : '需停用并清理关联数据' }, { key: 'time', label: '检查时间', children: readiness.checkedAt },
          ]} /><Space wrap style={{ marginTop: 16 }}><Link to={`/models?provider=${encodeURIComponent(readiness.provider)}`}>关联模型</Link><Link to={`/tasks?provider=${encodeURIComponent(readiness.provider)}`}>关联任务</Link><Button onClick={() => { setPoolModalProvider(readiness.provider); setPoolModalOpen(true); }}>管理账号池</Button></Space></>}
      </Drawer>
      <PageHeader
        title="供应商配置"
        leftExtra={(
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} disabled={!canUpdate}>
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
        scroll={{ x: 1320 }}
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
            title: '状态',
            key: 'enabled',
            width: 100,
            render: (_, r) => (
              <Switch
                checked={r.enabled}
                checkedChildren="启用"
                unCheckedChildren="停用"
                loading={busyProviders[r.provider_name]}
                disabled={!canUpdate}
                aria-label={`${r.provider_name} 启用状态`}
                onChange={enabled => void setEnabled(r, enabled)}
              />
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
            width: 160,
            fixed: 'right' as const,
            render: (_, r) => (
              <Space size={0}>
          <Button type="link" size="small" loading={checking} onClick={() => inspect(r.provider_name)}>配置检查</Button>
                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} disabled={!canUpdate || busyProviders[r.provider_name]}>
                  编辑
                </Button>
                <Tooltip title={r.enabled ? '请先停用供应商，再删除配置' : undefined}>
                  <Button type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => confirmDelete(r)} disabled={!canDelete || r.enabled || busyProviders[r.provider_name]}>
                    删除
                  </Button>
                </Tooltip>
              </Space>
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
        confirmLoading={saving}
        okButtonProps={{ disabled: !!saveNotice?.needsReload }}
        cancelButtonProps={{ disabled: saving }}
        closable={!saving}
        maskClosable={!saving}
        keyboard={!saving}
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        width={560}
      >
        {saveNotice && <Alert type="warning" showIcon role="alert" message={saveNotice.message} style={{ marginBottom: 16 }}
          action={saveNotice.needsReload && editing ? <Button onClick={() => void openEdit(editing)}>放弃当前修改并加载最新配置</Button> : undefined} />}
        <Form form={form} layout="vertical" disabled={saving}>
          <Form.Item
            name="provider_name"
            label="厂商名称"
            rules={[{ required: true, message: '请输入厂商名称' }]}
          >
            {editing ? <Input disabled /> : (
              <Select
                showSearch
                placeholder="请选择已接入的厂商"
                options={availableProviders.filter(name => !items.some(item => item.provider_name === name)).map(name => ({ label: name, value: name }))}
              />
            )}
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
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.provider_name !== cur.provider_name}>
            {({ getFieldValue }) => getFieldValue('provider_name') === 'akool-openapi' ? <Alert type="info" showIcon style={{ marginBottom: 16 }} message="VoiceLab TTS 使用独立 OpenAPI 凭证" description="Base URL 通常为 https://openapi.akool.com。API Key 请在此供应商的账号池中配置；不会复用 MaaS 密钥。模型价格在模型配置中维护，补全后再启用。" /> : null}
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.provider_name !== cur.provider_name}>
            {({ getFieldValue }) => getFieldValue('provider_name') === 'akool-maas' ? <Form.Item name="llm_base_url" label="LLM Base URL（可选）" rules={[{ validator: async (_, value) => validateLlmBaseUrl(value) }]} extra="LLM 使用独立地址，以 /v1 结尾。FAT 文档地址：https://llm-fat.akool.io/v1。模型与价格另行配置；使用本厂商账号池凭证。">
              <Input placeholder="https://llm-fat.akool.io/v1" />
            </Form.Item> : null}
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
