import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Table, Card, Button, Space, Typography, Input, message, Tag, Modal, Form, Select, Switch,
  InputNumber, DatePicker, Popconfirm,
} from 'antd';
import { ReloadOutlined, SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { modelRoutingApi, providerConfigApi } from '../services/api';

type Strategy = 'fixed' | 'weighted' | 'primary_fallback';

interface RuleRow {
  _id: string;
  model_name: string;
  client_id?: string;
  enabled: boolean;
  priority?: number;
  effective_from?: string;
  effective_until?: string;
  strategy_type: Strategy;
  fixed_provider?: string;
  weighted_targets?: { provider: string; weight: number }[];
  primary_provider?: string;
  fallback_provider?: string;
  primary_weight?: number;
  fallback_weight?: number;
  note?: string;
}

function strategySummary(r: RuleRow): string {
  if (r.strategy_type === 'fixed') return r.fixed_provider || '—';
  if (r.strategy_type === 'weighted') {
    const t = r.weighted_targets || [];
    return t.map((x) => `${x.provider}:${x.weight}`).join(' / ') || '—';
  }
  const p = r.primary_provider || '';
  const f = r.fallback_provider || '';
  if (!f) return `${p}（仅主）`;
  return `${p} / ${f}（${r.primary_weight ?? 100}:${r.fallback_weight ?? 0}）`;
}

function getCreateFormDefaults(modelName = '') {
  return {
    model_name: modelName,
    enabled: true,
    priority: 0,
    client_id: '',
    strategy_type: 'fixed' as Strategy,
    weighted_targets: [{ provider: '', weight: 100 }],
    primary_weight: 100,
    fallback_weight: 0,
  };
}

export default function ModelRoutingRulesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryConsumedRef = useRef(false);

  const [items, setItems] = useState<RuleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [form] = Form.useForm();
  const [providers, setProviders] = useState<string[]>([]);

  const fetchData = useCallback(async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const res: any = await modelRoutingApi.list({
        page: p,
        pageSize: ps,
        model_name: keyword.trim() || undefined,
      });
      setItems(res.data?.items || []);
      setTotal(res.data?.total ?? 0);
      setPage(res.data?.page ?? p);
      setPageSize(res.data?.pageSize ?? ps);
    } catch {
      message.error('加载路由规则失败');
    }
    setLoading(false);
  }, [keyword, page, pageSize]);

  useEffect(() => {
    void fetchData(1, pageSize);
    void fetchProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时拉取首屏
  }, []);

  const fetchProviders = async () => {
    try {
      const res: any = await providerConfigApi.list();
      const providerNames = (res.data?.items || []).map((item: any) => item.provider_name);
      setProviders(providerNames);
    } catch {
      message.error('加载厂商列表失败');
    }
  };

  /** 从模型配置「配置路由」跳转：`/model-routing-rules?action=new&model_name=...` */
  useEffect(() => {
    if (queryConsumedRef.current) return;
    const action = searchParams.get('action');
    const mn = searchParams.get('model_name');
    if (action !== 'new' || !mn?.trim()) return;
    queryConsumedRef.current = true;
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(getCreateFormDefaults(mn.trim()));
    setModalOpen(true);
    navigate('/model-routing-rules', { replace: true });
  }, [searchParams, form, navigate]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(getCreateFormDefaults());
    setModalOpen(true);
  };

  const openEdit = (r: RuleRow) => {
    setEditing(r);
    form.setFieldsValue({
      model_name: r.model_name,
      client_id: r.client_id ?? '',
      enabled: r.enabled !== false,
      priority: r.priority ?? 0,
      effective_from: r.effective_from ? dayjs(r.effective_from) : undefined,
      effective_until: r.effective_until ? dayjs(r.effective_until) : undefined,
      strategy_type: r.strategy_type,
      fixed_provider: r.fixed_provider,
      weighted_targets: (r.weighted_targets?.length ? r.weighted_targets : [{ provider: '', weight: 100 }]),
      primary_provider: r.primary_provider,
      fallback_provider: r.fallback_provider,
      primary_weight: r.primary_weight ?? 100,
      fallback_weight: r.fallback_weight ?? 0,
      note: r.note,
    });
    setModalOpen(true);
  };

  const buildPayload = (v: Record<string, unknown>) => {
    const strategy = v.strategy_type as Strategy;
    const payload: Record<string, unknown> = {
      model_name: String(v.model_name).trim(),
      client_id: v.client_id != null ? String(v.client_id).trim() : '',
      enabled: v.enabled !== false,
      priority: Number(v.priority) || 0,
      effective_from: (v.effective_from as Dayjs | undefined)?.toISOString(),
      effective_until: (v.effective_until as Dayjs | undefined)?.toISOString(),
      strategy_type: strategy,
      note: v.note ? String(v.note) : undefined,
    };
    if (strategy === 'fixed') {
      payload.fixed_provider = String(v.fixed_provider || '').trim();
    }
    if (strategy === 'weighted') {
      const wt = (v.weighted_targets as { provider?: string; weight?: number }[]) || [];
      payload.weighted_targets = wt
        .filter((x) => x.provider?.trim())
        .map((x) => ({ provider: String(x.provider).trim(), weight: Number(x.weight) || 0 }));
    }
    if (strategy === 'primary_fallback') {
      payload.primary_provider = String(v.primary_provider || '').trim();
      payload.fallback_provider = v.fallback_provider ? String(v.fallback_provider).trim() : undefined;
      payload.primary_weight = v.primary_weight != null ? Number(v.primary_weight) : 100;
      payload.fallback_weight = v.fallback_weight != null ? Number(v.fallback_weight) : 0;
    }
    return payload;
  };

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      const payload = buildPayload(v);
      if (editing) {
        await modelRoutingApi.update(editing._id, payload);
        message.success('已更新');
      } else {
        await modelRoutingApi.create(payload);
        message.success('已创建');
      }
      setModalOpen(false);
      fetchData(page, pageSize);
    } catch (e: any) {
      if (e?.errorFields) return;
      const msg = e?.response?.data?.message || e?.message;
      message.error(msg || (editing ? '更新失败' : '创建失败'));
    }
  };

  const handleDelete = async (r: RuleRow) => {
    try {
      await modelRoutingApi.remove(r._id);
      message.success('已删除');
      fetchData(page, pageSize);
    } catch {
      message.error('删除失败');
    }
  };

  const strategyColors: Record<Strategy, string> = {
    fixed: 'blue',
    weighted: 'purple',
    primary_fallback: 'cyan',
  };

  const columns = [
    { title: 'model_name', dataIndex: 'model_name', key: 'model_name', ellipsis: true, width: 280 },
    {
      title: 'client_id',
      dataIndex: 'client_id',
      key: 'client_id',
      width: 120,
      render: (t: string) => (t ? t : <Typography.Text type="secondary">（全站）</Typography.Text>),
    },
    {
      title: '策略',
      dataIndex: 'strategy_type',
      key: 'strategy_type',
      width: 130,
      render: (t: Strategy) => <Tag color={strategyColors[t]}>{t}</Tag>,
    },
    { title: '目标 / 权重', key: 'sum', ellipsis: true, render: (_: unknown, r: RuleRow) => strategySummary(r) },
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 72 },
    {
      title: '状态',
      key: 'en',
      width: 72,
      render: (_: unknown, r: RuleRow) => (
        <Tag color={r.enabled !== false ? 'green' : 'default'}>{r.enabled !== false ? '启用' : '停用'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'act',
      width: 140,
      fixed: 'right' as const,
      render: (_: unknown, r: RuleRow) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确定删除该规则？" onConfirm={() => handleDelete(r)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>路由规则</Typography.Title>
        <Typography.Text type="secondary">覆盖 model_configs.service；支持固定 / 权重分流 / 主备比例</Typography.Text>
      </Space>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          placeholder="筛选 model_name"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => fetchData(1, pageSize)}
          style={{ width: 260 }}
          allowClear
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={() => fetchData(1, pageSize)}>查询</Button>
        <Button icon={<ReloadOutlined />} onClick={() => fetchData(page, pageSize)}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建规则</Button>
      </Space>

      <Card>
        <Table
          columns={columns}
          dataSource={items}
          rowKey="_id"
          loading={loading}
          size="small"
          scroll={{ x: 1000 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => fetchData(p, ps || pageSize),
          }}
        />
      </Card>

      <Modal
        title={editing ? '编辑路由规则' : '新建路由规则'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        width={640}
        destroyOnClose
        okText="保存"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="model_name" label="model_name" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="与创建任务时的 model 完全一致" />
          </Form.Item>
          <Form.Item name="client_id" label="client_id（空 = 全客户端）">
            <Input placeholder="留空表示全站" />
          </Form.Item>
          <Space wrap style={{ width: '100%' }}>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="priority" label="优先级（越大越优先）">
              <InputNumber min={0} style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="effective_from" label="生效开始">
              <DatePicker showTime />
            </Form.Item>
            <Form.Item name="effective_until" label="生效结束">
              <DatePicker showTime />
            </Form.Item>
          </Space>

          <Form.Item name="strategy_type" label="策略类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'fixed', label: 'fixed — 固定单一厂商' },
                { value: 'weighted', label: 'weighted — 多厂商按权重' },
                { value: 'primary_fallback', label: 'primary_fallback — 主备比例' },
              ]}
            />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(p, c) => p.strategy_type !== c.strategy_type}>
            {() => {
              const st = form.getFieldValue('strategy_type') as Strategy;
              if (st === 'fixed') {
                return (
                  <Form.Item name="fixed_provider" label="fixed_provider" rules={[{ required: true, message: '必填' }]}>
                    <Select
                      placeholder="选择厂商"
                      showSearch
                      allowClear
                      options={providers.map((p) => ({ label: p, value: p }))}
                    />
                  </Form.Item>
                );
              }
              if (st === 'weighted') {
                return (
                  <>
                    <Typography.Text type="secondary">至少一行，weight 为正整数</Typography.Text>
                    <Form.List name="weighted_targets">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...rest }) => (
                            <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                              <Form.Item {...rest} name={[name, 'provider']} rules={[{ required: true, message: 'provider' }]}>
                                <Select
                                  placeholder="选择厂商"
                                  showSearch
                                  allowClear
                                  style={{ width: 200 }}
                                  options={providers.map((p) => ({ label: p, value: p }))}
                                />
                              </Form.Item>
                              <Form.Item {...rest} name={[name, 'weight']} rules={[{ required: true, message: 'weight' }]}>
                                <InputNumber min={1} placeholder="weight" />
                              </Form.Item>
                              <Button type="link" onClick={() => remove(name)}>删除</Button>
                            </Space>
                          ))}
                          <Button type="dashed" onClick={() => add({ provider: '', weight: 10 })} block>
                            添加一行
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                );
              }
              if (st === 'primary_fallback') {
                return (
                  <>
                    <Form.Item name="primary_provider" label="primary_provider（主）" rules={[{ required: true }]}>
                      <Select
                        placeholder="选择主厂商"
                        showSearch
                        allowClear
                        options={providers.map((p) => ({ label: p, value: p }))}
                      />
                    </Form.Item>
                    <Form.Item name="fallback_provider" label="fallback_provider（备，可空）">
                      <Select
                        placeholder="选择备用厂商"
                        showSearch
                        allowClear
                        options={providers.map((p) => ({ label: p, value: p }))}
                      />
                    </Form.Item>
                    <Space>
                      <Form.Item name="primary_weight" label="primary_weight">
                        <InputNumber min={0} />
                      </Form.Item>
                      <Form.Item name="fallback_weight" label="fallback_weight">
                        <InputNumber min={0} />
                      </Form.Item>
                    </Space>
                  </>
                );
              }
              return null;
            }}
          </Form.Item>

          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="灰度原因等" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
