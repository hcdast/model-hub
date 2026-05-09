import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Table, Card, Button, Space, Typography, Input, message, Tag, Modal, Form, Select, Switch,
  InputNumber, DatePicker, Popconfirm, Tooltip, Descriptions, Alert, Collapse, AutoComplete,
} from 'antd';
import {
  ReloadOutlined, SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined,
  ExperimentOutlined, UndoOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { modelRoutingApi, providerConfigApi, modelApi, apiClientApi } from '../services/api';

type Strategy = 'fixed' | 'weighted' | 'primary_fallback' | 'latency' | 'cost';

interface CostTarget {
  provider: string;
  costPerUnit: number;
}

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
  latency_targets?: string[];
  cost_targets?: CostTarget[];
  note?: string;
}

function strategySummary(r: RuleRow): string {
  if (r.strategy_type === 'fixed') return r.fixed_provider || '—';
  if (r.strategy_type === 'weighted') {
    const t = r.weighted_targets || [];
    return t.map((x) => `${x.provider}:${x.weight}`).join(' / ') || '—';
  }
  if (r.strategy_type === 'latency') {
    const targets = r.latency_targets || [];
    return targets.length > 0 ? targets.join(' / ') : '—';
  }
  if (r.strategy_type === 'cost') {
    const targets = r.cost_targets || [];
    return targets.length > 0
      ? targets.map((x) => `${x.provider}:¥${x.costPerUnit}`).join(' / ')
      : '—';
  }
  // primary_fallback
  const p = r.primary_provider || '';
  const f = r.fallback_provider || '';
  if (!f) return `${p}（仅主）`;
  return `${p} / ${f}（${r.primary_weight ?? 100}:${r.fallback_weight ?? 0}）`;
}

/** 与创建任务 options.featureType 一致（可选，用于 model_configs 查询） */
const SIM_FEATURE_OPTIONS = [
  { label: '（按 model 路径推断）', value: '' },
  { label: 'textToImage', value: 'textToImage' },
  { label: 'imageToImage', value: 'imageToImage' },
  { label: 'textToVideo', value: 'textToVideo' },
  { label: 'imageToVideo', value: 'imageToVideo' },
  { label: 'characterFaceswap', value: 'characterFaceswap' },
  { label: 'videoUpscale', value: 'videoUpscale' },
];

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
    latency_targets: ['', ''],
    cost_targets: [{ provider: '', costPerUnit: 0 }],
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
  const [loadingProviderPricing, setLoadingProviderPricing] = useState(false);

  const [simForm] = Form.useForm();
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<any>(null);
  const [clientOptions, setClientOptions] = useState<{ label: string; value: string }[]>([]);

  const fetchData = useCallback(async (p = page, ps = pageSize, keywordOverride?: string) => {
    const kw = keywordOverride !== undefined ? keywordOverride : keyword;
    setLoading(true);
    try {
      const res: any = await modelRoutingApi.list({
        page: p,
        pageSize: ps,
        model_name: kw.trim() || undefined,
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
    void loadClientOptions();
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

  const loadClientOptions = async () => {
    try {
      const res: any = await apiClientApi.list({ page: 1, pageSize: 200 });
      const items: any[] = res.data?.items || [];
      setClientOptions(
        items.map((c) => ({
          value: c.clientId,
          label: c.name ? `${c.clientId} (${c.name})` : c.clientId,
        })),
      );
    } catch {
      setClientOptions([]);
    }
  };

  const runSimulation = async () => {
    const v = await simForm.validateFields().catch(() => null);
    if (!v) return;
    setSimLoading(true);
    setSimResult(null);
    try {
      const body: Record<string, unknown> = {
        model_name: String(v.sim_model_name).trim(),
        client_id: String(v.sim_client_id).trim(),
      };
      const ft = v.sim_featureType as string | undefined;
      if (ft) body.featureType = ft;
      const at = v.sim_at as Dayjs | undefined;
      if (at) body.at = at.toISOString();
      const res: any = await modelRoutingApi.simulate(body);
      setSimResult(res.data);
      message.success('仿真完成');
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message;
      message.error(msg || '仿真失败');
    }
    setSimLoading(false);
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
      latency_targets: r.latency_targets?.length ? r.latency_targets : ['', ''],
      cost_targets: r.cost_targets?.length ? r.cost_targets : [{ provider: '', costPerUnit: 0 }],
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
    if (strategy === 'latency') {
      const targets = (v.latency_targets as string[]) || [];
      payload.latency_targets = targets.filter((t) => t?.trim()).map((t) => String(t).trim());
    }
    if (strategy === 'cost') {
      const targets = (v.cost_targets as CostTarget[]) || [];
      payload.cost_targets = targets
        .filter((t) => t.provider?.trim())
        .map((t) => ({ provider: String(t.provider).trim(), costPerUnit: Number(t.costPerUnit) || 0 }));
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
    latency: 'green',
    cost: 'orange',
  };

  /** 渲染 latency 规则的实时延迟数据 */
  const renderLatencyData = (r: RuleRow) => {
    const targets = r.latency_targets || [];
    if (targets.length === 0) return '—';
    return (
      <Space size={[4, 4]} wrap>
        {targets.map((provider) => (
          <Tooltip key={provider} title={`延迟优先候选: ${provider}`}>
            <Tag color="green">{provider}</Tag>
          </Tooltip>
        ))}
      </Space>
    );
  };

  /** 渲染 cost 规则的成本数据 */
  const renderCostData = (r: RuleRow) => {
    const targets = r.cost_targets || [];
    if (targets.length === 0) return '—';
    return (
      <Space size={[4, 4]} wrap>
        {targets.map((t) => (
          <Tooltip key={t.provider} title={`${t.provider}: ¥${t.costPerUnit}/单位`}>
            <Tag color="orange">{t.provider}: ¥{t.costPerUnit}</Tag>
          </Tooltip>
        ))}
      </Space>
    );
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
      render: (t: Strategy) => <Tag color={strategyColors[t] || 'default'}>{t}</Tag>,
    },
    {
      title: '目标 / 权重',
      key: 'sum',
      ellipsis: true,
      render: (_: unknown, r: RuleRow) => {
        if (r.strategy_type === 'latency') return renderLatencyData(r);
        if (r.strategy_type === 'cost') return renderCostData(r);
        return strategySummary(r);
      },
    },
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
      <PageHeader
        title="路由规则"
        leftExtra={(
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建规则</Button>
        )}
        extra={(
          <>
            <Input
              placeholder="筛选 model_name"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => fetchData(1, pageSize)}
              style={{ width: 260 }}
              allowClear
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={() => fetchData(1, pageSize)}>查询</Button>
            <Button
              icon={<UndoOutlined />}
              onClick={() => {
                setKeyword('');
                void fetchData(1, pageSize, '');
              }}
            >
              重置
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => fetchData(page, pageSize)}>刷新</Button>
          </>
        )}
      />

      <Card
        title={(
          <Space>
            <ExperimentOutlined />
            <span>路由仿真 / 调试</span>
          </Space>
        )}
        style={{ marginBottom: 16 }}
        size="small"
      >
        <Form form={simForm} layout="vertical">
          <Space wrap style={{ width: '100%' }} align="start">
            <Form.Item
              name="sim_model_name"
              label="model_name"
              rules={[{ required: true, message: '必填' }]}
              style={{ minWidth: 280, marginBottom: 8 }}
            >
              <Input placeholder="与 API 创建任务时的 model 一致" allowClear />
            </Form.Item>
            <Form.Item
              name="sim_client_id"
              label="client_id"
              rules={[{ required: true, message: '必填' }]}
              style={{ minWidth: 320, marginBottom: 8 }}
            >
              <AutoComplete
                allowClear
                placeholder="输入或从下拉选择 clientId"
                options={clientOptions}
                filterOption={(input, option) =>
                  (option?.value as string)?.toLowerCase().includes(input.toLowerCase()) ||
                  (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ||
                  false
                }
              />
            </Form.Item>
            <Form.Item name="sim_featureType" label="featureType（可选）" style={{ minWidth: 220, marginBottom: 8 }}>
              <Select options={SIM_FEATURE_OPTIONS} placeholder="推断 model_type 用" allowClear />
            </Form.Item>
            <Form.Item name="sim_at" label="判定时间 at（可选）" style={{ minWidth: 220, marginBottom: 8 }}>
              <DatePicker showTime style={{ width: '100%' }} placeholder="默认当前时间" />
            </Form.Item>
            <Form.Item label=" " colon={false} style={{ marginBottom: 8 }}>
              <Button type="primary" icon={<ExperimentOutlined />} loading={simLoading} onClick={() => void runSimulation()}>
                运行仿真
              </Button>
            </Form.Item>
          </Space>
        </Form>

        {simResult && (
          <div style={{ marginTop: 16 }}>
            {(simResult.warnings?.length > 0) && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="提示"
                description={(
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {simResult.warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              />
            )}
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="最终 provider">{simResult.resolution?.provider ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="routingSource">{simResult.resolution?.routingSource}</Descriptions.Item>
              <Descriptions.Item label="routeId">{simResult.resolution?.routeId ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Adapter 已注册">
                {simResult.resolution?.adapterRegistered ? <Tag color="green">是</Tag> : <Tag color="red">否</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="推断 featureType">{simResult.inferredFeatureType}</Descriptions.Item>
              <Descriptions.Item label="查询 model_type">{simResult.modelTypeUsed ?? '（未限定）'}</Descriptions.Item>
            </Descriptions>
            <Collapse
              items={[
                {
                  key: 'rules',
                  label: `规则评估（共 ${simResult.ruleSimulation?.evaluations?.length ?? 0} 条）`,
                  children: (
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="ruleId"
                      dataSource={simResult.ruleSimulation?.evaluations || []}
                      columns={[
                        { title: 'ruleId', dataIndex: 'ruleId', width: 200, ellipsis: true },
                        { title: 'client_id', dataIndex: 'client_id', width: 120, render: (t: string) => t || '（全站）' },
                        { title: '策略', dataIndex: 'strategy_type', width: 120 },
                        { title: '优先级', dataIndex: 'priority', width: 72 },
                        {
                          title: '候选',
                          dataIndex: 'isCandidate',
                          width: 72,
                          render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
                        },
                        {
                          title: '跳过原因',
                          dataIndex: 'skipReasons',
                          render: (reasons: string[]) =>
                            (reasons?.length ? reasons.join('；') : '—'),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: 'debug',
                  label: '胜出规则解析细节（resolutionDebug）',
                  children: simResult.ruleSimulation?.resolutionDebug ? (
                    <Typography.Paragraph copyable>
                      <pre style={{ margin: 0, fontSize: 12, maxHeight: 360, overflow: 'auto' }}>
                        {JSON.stringify(simResult.ruleSimulation.resolutionDebug, null, 2)}
                      </pre>
                    </Typography.Paragraph>
                  ) : (
                    <Typography.Text type="secondary">无（未命中可解析规则或解析失败）</Typography.Text>
                  ),
                },
                {
                  key: 'fallback',
                  label: '兜底与 model 配置摘要',
                  children: (
                    <>
                      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                        fallbackDetail（model_configs / 路径兜底）
                      </Typography.Text>
                      <pre style={{ fontSize: 12, maxHeight: 240, overflow: 'auto' }}>
                        {JSON.stringify(simResult.resolution?.fallbackDetail ?? {}, null, 2)}
                      </pre>
                      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, marginBottom: 8 }}>
                        modelConfig
                      </Typography.Text>
                      <pre style={{ fontSize: 12, maxHeight: 240, overflow: 'auto' }}>
                        {JSON.stringify(simResult.modelConfig ?? null, null, 2)}
                      </pre>
                    </>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Card>

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
                { value: 'latency', label: 'latency — 延迟优先（自动选最快）' },
                { value: 'cost', label: 'cost — 成本优先（自动选最便宜）' },
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
              if (st === 'latency') {
                return (
                  <>
                    <Typography.Text type="secondary">
                      延迟优先策略：系统自动选择延迟最低的 Provider（至少 2 个候选）
                    </Typography.Text>
                    <Form.List
                      name="latency_targets"
                      rules={[
                        {
                          validator: async (_, targets) => {
                            const valid = (targets || []).filter((t: string) => t?.trim());
                            if (valid.length < 2) {
                              return Promise.reject(new Error('至少需要 2 个 Provider'));
                            }
                          },
                        },
                      ]}
                    >
                      {(fields, { add, remove }, { errors }) => (
                        <>
                          {fields.map(({ key, name, ...rest }) => (
                            <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                              <Form.Item
                                {...rest}
                                name={name}
                                rules={[{ required: true, message: '请选择 Provider' }]}
                              >
                                <Select
                                  placeholder="选择厂商"
                                  showSearch
                                  allowClear
                                  style={{ width: 280 }}
                                  options={providers.map((p) => ({ label: p, value: p }))}
                                />
                              </Form.Item>
                              {fields.length > 2 && (
                                <Button
                                  type="link"
                                  danger
                                  icon={<MinusCircleOutlined />}
                                  onClick={() => remove(name)}
                                >
                                  删除
                                </Button>
                              )}
                            </Space>
                          ))}
                          <Form.Item>
                            <Button type="dashed" onClick={() => add('')} block>
                              添加 Provider
                            </Button>
                            <Form.ErrorList errors={errors} />
                          </Form.Item>
                        </>
                      )}
                    </Form.List>
                  </>
                );
              }
              if (st === 'cost') {
                return (
                  <>
                    <Space style={{ width: '100%', marginBottom: 8 }} align="center">
                      <Typography.Text type="secondary">
                        成本优先策略：系统自动选择单价最低的 Provider（至少 1 个候选）
                      </Typography.Text>
                      <Button
                        type="link"
                        loading={loadingProviderPricing}
                        onClick={async () => {
                          const modelName = form.getFieldValue('model_name');
                          if (!modelName?.trim()) {
                            message.warning('请先填写 model_name');
                            return;
                          }
                          setLoadingProviderPricing(true);
                          try {
                            const res: any = await modelApi.getProviderPricing(modelName.trim());
                            const pricingData = res.data || [];
                            if (pricingData.length === 0) {
                              message.info('该模型暂无厂商定价数据');
                              return;
                            }
                            // 自动填充 cost_targets
                            form.setFieldsValue({
                              cost_targets: pricingData.map((item: { provider: string; costPerUnit: number }) => ({
                                provider: item.provider,
                                costPerUnit: item.costPerUnit,
                              })),
                            });
                            message.success(`已加载 ${pricingData.length} 个厂商的定价信息`);
                          } catch {
                            message.error('加载厂商定价失败');
                          } finally {
                            setLoadingProviderPricing(false);
                          }
                        }}
                      >
                        自动加载厂商定价
                      </Button>
                    </Space>
                    <Form.List name="cost_targets">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...rest }) => (
                            <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                              <Form.Item
                                {...rest}
                                name={[name, 'provider']}
                                rules={[{ required: true, message: '请选择 Provider' }]}
                              >
                                <Select
                                  placeholder="选择厂商"
                                  showSearch
                                  allowClear
                                  style={{ width: 200 }}
                                  options={providers.map((p) => ({ label: p, value: p }))}
                                />
                              </Form.Item>
                              <Form.Item
                                {...rest}
                                name={[name, 'costPerUnit']}
                                rules={[{ required: true, message: '请输入单价' }]}
                              >
                                <InputNumber
                                  min={0}
                                  step={0.01}
                                  placeholder="单价 (costPerUnit)"
                                  style={{ width: 180 }}
                                  addonAfter="¥/单位"
                                />
                              </Form.Item>
                              <Button
                                type="link"
                                danger
                                icon={<MinusCircleOutlined />}
                                onClick={() => remove(name)}
                              >
                                删除
                              </Button>
                            </Space>
                          ))}
                          <Button type="dashed" onClick={() => add({ provider: '', costPerUnit: 0 })} block>
                            添加 Provider
                          </Button>
                        </>
                      )}
                    </Form.List>
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
