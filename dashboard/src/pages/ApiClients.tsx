import { useEffect, useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import {
  Table, Card, Button, Space, Typography, Switch, message, Modal, Form, Input, InputNumber, Tag, Select, Tooltip,
  Progress,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, KeyOutlined, EditOutlined, BarChartOutlined, CopyOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { apiClientApi, modelApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';
import { usePermission } from '../hooks/usePermission';
import PageHeader from '../components/PageHeader';

/** API Key 列表列：小号等宽，与其它列信息密度对齐 */
const API_KEY_CELL_FONT: CSSProperties = {
  fontSize: 11,
  lineHeight: 1.45,
  fontFamily: 'ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Monaco, Consolas, monospace',
  wordBreak: 'break-all',
};

/** 计费策略颜色映射 */
const BILLING_POLICY_COLOR: Record<string, string> = {
  internal: 'blue',
  external: 'green',
  exempt: 'default',
};

/** 功能类型（与 model_configs.model_type 一致） */
const FEATURE_TYPE_OPTIONS = [
  { label: '文生图 (textToImage)', value: 'textToImage' },
  { label: '图生图 (imageToImage)', value: 'imageToImage' },
  { label: '文生视频 (textToVideo)', value: 'textToVideo' },
  { label: '图生视频 (imageToVideo)', value: 'imageToVideo' },
  { label: '视频生视频 (videoToVideo)', value: 'videoToVideo' },
  { label: '角色换装 (characterSwap)', value: 'characterSwap' },
  { label: '视频超分 (videoUpscale)', value: 'videoUpscale' },
];

/** 计费策略中文标签 */
const BILLING_POLICY_LABEL: Record<string, string> = {
  internal: '内部计费',
  external: '外部记录',
  exempt: '免计费',
};

/** 计费策略下拉选项 */
const BILLING_POLICY_OPTIONS = [
  { label: '内部计费 (internal)', value: 'internal' },
  { label: '外部记录 (external)', value: 'external' },
  { label: '免计费 (exempt)', value: 'exempt' },
];

/** 限流状态指示器：根据当日用量与限额比例显示状态 */
function RateLimitStatusTag({ dailyRequests, maxDailyRequests }: { dailyRequests: number; maxDailyRequests: number }) {
  if (!maxDailyRequests || maxDailyRequests <= 0) {
    return <Tag color="default">未配置</Tag>;
  }
  const ratio = dailyRequests / maxDailyRequests;
  if (ratio >= 1) {
    return <Tag color="red">已超限</Tag>;
  }
  if (ratio >= 0.8) {
    return <Tag color="orange">接近限额</Tag>;
  }
  return <Tag color="green">正常</Tag>;
}

/** 用量图表组件：展示最近 7 天每日请求趋势 */
function UsageChart({ apiKey }: { apiKey: string }) {
  const [loading, setLoading] = useState(false);
  const [usageData, setUsageData] = useState<any[]>([]);

  useEffect(() => {
    const fetchUsage = async () => {
      setLoading(true);
      try {
        const to = dayjs().format('YYYYMMDD');
        const from = dayjs().subtract(6, 'day').format('YYYYMMDD');
        const res: any = await apiClientApi.getUsage(apiKey, { from, to });
        setUsageData(res.data || []);
      } catch {
        // 静默处理，图表区域显示空状态
        setUsageData([]);
      }
      setLoading(false);
    };
    fetchUsage();
  }, [apiKey]);

  const chartOption = useMemo(() => {
    // 生成最近 7 天日期列表
    const dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      dates.push(dayjs().subtract(i, 'day').format('YYYYMMDD'));
    }

    // 将用量数据映射到日期
    const dataMap = new Map<string, any>();
    usageData.forEach((item: any) => {
      dataMap.set(item.date, item);
    });

    const totalRequests = dates.map((d) => dataMap.get(d)?.totalRequests ?? 0);
    const successRequests = dates.map((d) => dataMap.get(d)?.successRequests ?? 0);
    const failedRequests = dates.map((d) => dataMap.get(d)?.failedRequests ?? 0);
    const totalCost = dates.map((d) => dataMap.get(d)?.totalCost ?? 0);
    const dateLabels = dates.map((d) => `${d.slice(4, 6)}-${d.slice(6, 8)}`);

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['总请求', '成功', '失败', '计费(元)'], bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dateLabels },
      yAxis: [
        { type: 'value', name: '请求数', min: 0 },
        { type: 'value', name: '元', min: 0, splitLine: { show: false } },
      ],
      series: [
        {
          name: '总请求',
          type: 'line',
          smooth: true,
          data: totalRequests,
          itemStyle: { color: '#1890ff' },
          lineStyle: { width: 2 },
          areaStyle: { color: 'rgba(24, 144, 255, 0.1)' },
        },
        {
          name: '成功',
          type: 'line',
          smooth: true,
          data: successRequests,
          itemStyle: { color: '#52c41a' },
          lineStyle: { width: 2 },
        },
        {
          name: '失败',
          type: 'line',
          smooth: true,
          data: failedRequests,
          itemStyle: { color: '#ff4d4f' },
          lineStyle: { width: 2 },
        },
        {
          name: '计费(元)',
          type: 'bar',
          yAxisIndex: 1,
          data: totalCost,
          itemStyle: { color: 'rgba(250, 173, 20, 0.45)' },
        },
      ],
    };
  }, [usageData]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 24 }}>加载中...</div>;
  }

  return (
    <ReactECharts
      option={chartOption}
      style={{ height: 240 }}
      notMerge
      lazyUpdate
    />
  );
}

export default function ApiClientsPage() {
  const pageTitle = '应用管理';
  const { hasPermission } = usePermission();
  const canCreateClient = hasPermission('api-client:create');
  const canUpdateClient = hasPermission('api-client:update');
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
  const [billingPolicyForm] = Form.useForm();
  const [billingPolicyOpen, setBillingPolicyOpen] = useState(false);
  const [billingPolicyClient, setBillingPolicyClient] = useState<any>(null);

  // 限流配置编辑状态
  const [rateLimitForm] = Form.useForm();
  const [rateLimitOpen, setRateLimitOpen] = useState(false);
  const [rateLimitClient, setRateLimitClient] = useState<any>(null);

  // 模型白名单编辑状态
  const [allowlistForm] = Form.useForm();
  const [allowlistOpen, setAllowlistOpen] = useState(false);
  const [allowlistClient, setAllowlistClient] = useState<any>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedFeatureType, setSelectedFeatureType] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  // 用量图表弹窗状态
  const [usageChartOpen, setUsageChartOpen] = useState(false);
  const [usageChartClient, setUsageChartClient] = useState<any>(null);

  // 用量汇总数据
  const [usageSummaryMap, setUsageSummaryMap] = useState<Map<string, any>>(new Map());

  const fetchData = async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const res: any = await apiClientApi.list({ page: p, pageSize: ps });
      setItems(res.data?.items || []);
      setTotal(res.data?.total ?? 0);
      setPage(res.data?.page ?? p);
      setPageSize(res.data?.pageSize ?? ps);
    } catch (err) {
      ErrorHandler.handleApiError(err, '加载失败');
    }
    setLoading(false);
  };

  /** 获取用量汇总 */
  const fetchUsageSummary = async () => {
    try {
      const res: any = await apiClientApi.getUsageSummary();
      const summaryList: any[] = res.data || [];
      const map = new Map<string, any>();
      summaryList.forEach((item: any) => {
        map.set(item.apiKey, item);
      });
      setUsageSummaryMap(map);
    } catch {
      // 静默处理
    }
  };

  /** 获取可用模型列表（用于白名单自动补全） */
  const fetchAvailableModels = async (modelTypeFilter?: string) => {
    setLoadingModels(true);
    try {
      const params: Record<string, any> = { page: 1, pageSize: 200 };
      if (modelTypeFilter) {
        params.model_type = modelTypeFilter;
      }
      const res: any = await modelApi.list(params);
      const modelItems: any[] = res.data?.items || [];
      const names = modelItems.map((m: any) => m.model_id || m.name).filter(Boolean);
      setAvailableModels(names);
    } catch {
      // 静默处理
    }
    setLoadingModels(false);
  };

  useEffect(() => {
    fetchData(1, pageSize);
    fetchUsageSummary();
    fetchAvailableModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setCreating(true);
    try {
      const createData: Record<string, any> = {
        name: values.name || undefined,
        billingPolicy: values.billingPolicy || 'internal',
        defaultPriority: values.defaultPriority ?? 50,
      };

      // 限流配置
      if (values.maxQps || values.maxConcurrent || values.maxDailyRequests) {
        createData.rateLimits = {
          maxQps: values.maxQps ?? 10,
          maxConcurrent: values.maxConcurrent ?? 50,
          maxDailyRequests: values.maxDailyRequests ?? 10000,
        };
      }

      const res: any = await apiClientApi.create(createData);
      const key = res.data?.fullCredential ?? res.data?.plainKey ?? res.data?.apiKey;
      Modal.success({
        title: '请立即保存 API Key',
        width: 560,
        content: (
          <div>
            {key ? (
              <Typography.Paragraph copyable={{ text: key }} style={{ marginBottom: 12, wordBreak: 'break-all' }}>
                <code style={{ fontSize: 13, display: 'block', whiteSpace: 'pre-wrap' }}>{key}</code>
              </Typography.Paragraph>
            ) : (
              <Typography.Paragraph type="danger" style={{ marginBottom: 12 }}>
                未能从响应中读取密钥字段。请重试创建或联系管理员。
              </Typography.Paragraph>
            )}
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              新建客户端的调用密钥与上表「apiKey」相同，请在网关/客户端配置的 API Key 请求头（如 X-API-Key）中传入该值。
            </Typography.Text>
            <Typography.Text type="secondary">关闭后将无法再次在界面中展示（列表仍显示 apiKey，即密钥本身）。</Typography.Text>
          </div>
        ),
      });
      setCreateOpen(false);
      form.resetFields();
      fetchData(1, pageSize);
    } catch (err) {
      ErrorHandler.handleApiError(err, '创建失败');
    }
    setCreating(false);
  };

  const onRotate = (apiKey: string) => {
    Modal.confirm({
      title: '轮换密钥？',
      content: '旧密钥将立即失效，请保存新密钥。',
      onOk: async () => {
        try {
          const res: any = await apiClientApi.rotate(apiKey);
          const key = res.data?.fullCredential ?? res.data?.plainKey ?? res.data?.apiKey;
          Modal.success({
            title: '新 API Key',
            width: 560,
            content: (
              <div>
                {key ? (
                  <Typography.Paragraph copyable={{ text: key }} style={{ wordBreak: 'break-all' }}>
                    <code style={{ fontSize: 13, display: 'block', whiteSpace: 'pre-wrap' }}>{key}</code>
                  </Typography.Paragraph>
                ) : (
                  <Typography.Text type="danger">未能读取新密钥，请重试或查看接口返回。</Typography.Text>
                )}
                <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                  关闭后将无法再次查看完整密钥。
                </Typography.Text>
              </div>
            ),
          });
          fetchData(page, pageSize);
        } catch (err) {
          ErrorHandler.handleApiError(err, '轮换失败');
        }
      },
    });
  };

  const onToggle = async (record: any, enabled: boolean) => {
    try {
      await apiClientApi.setEnabled(record.apiKey, enabled);
      message.success(enabled ? '已启用' : '已禁用');
      fetchData(page, pageSize);
    } catch (err) {
      ErrorHandler.handleApiError(err, '更新失败');
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
      await apiClientApi.updateDefaultPriority(editingClient.apiKey, values.defaultPriority);
      message.success('默认优先级已更新');
      setPriorityOpen(false);
      setEditingClient(null);
      fetchData(page, pageSize);
    } catch (err) {
      ErrorHandler.handleApiError(err, '更新失败');
    }
  };

  /** 打开计费策略编辑弹窗 */
  const onEditBillingPolicy = (record: any) => {
    setBillingPolicyClient(record);
    billingPolicyForm.setFieldsValue({ billingPolicy: record.billingPolicy ?? 'internal' });
    setBillingPolicyOpen(true);
  };

  /** 保存计费策略 */
  const onSaveBillingPolicy = async () => {
    const values = await billingPolicyForm.validateFields().catch(() => null);
    if (!values || !billingPolicyClient) return;
    try {
      await apiClientApi.updateBillingPolicy(billingPolicyClient.apiKey, values.billingPolicy);
      message.success('计费策略已更新');
      setBillingPolicyOpen(false);
      setBillingPolicyClient(null);
      fetchData(page, pageSize);
    } catch (err) {
      ErrorHandler.handleApiError(err, '更新失败');
    }
  };

  /** 打开限流配置编辑弹窗 */
  const onEditRateLimits = (record: any) => {
    setRateLimitClient(record);
    const rl = record.rateLimits || {};
    rateLimitForm.setFieldsValue({
      maxQps: rl.maxQps ?? 10,
      maxConcurrent: rl.maxConcurrent ?? 50,
      maxDailyRequests: rl.maxDailyRequests ?? 10000,
    });
    setRateLimitOpen(true);
  };

  /** 保存限流配置 */
  const onSaveRateLimits = async () => {
    const values = await rateLimitForm.validateFields().catch(() => null);
    if (!values || !rateLimitClient) return;
    try {
      await apiClientApi.updateRateLimits(rateLimitClient.apiKey, {
        maxQps: values.maxQps,
        maxConcurrent: values.maxConcurrent,
        maxDailyRequests: values.maxDailyRequests,
      });
      message.success('限流配置已更新');
      setRateLimitOpen(false);
      setRateLimitClient(null);
      fetchData(page, pageSize);
    } catch (err) {
      ErrorHandler.handleApiError(err, '更新失败');
    }
  };

  /** 打开模型白名单编辑弹窗 */
  const onEditAllowlist = (record: any) => {
    setAllowlistClient(record);
    allowlistForm.setFieldsValue({
      modelAllowlist: record.modelAllowlist || [],
    });
    setSelectedFeatureType(null);
    setAllowlistOpen(true);
    // 初始加载所有模型
    fetchAvailableModels();
  };

  /** 功能类型变更时重新拉取模型 */
  const onFeatureTypeChange = (value: string | null) => {
    setSelectedFeatureType(value);
    if (value) {
      fetchAvailableModels(value);
    } else {
      fetchAvailableModels();
    }
  };

  /** 保存模型白名单 */
  const onSaveAllowlist = async () => {
    const values = await allowlistForm.validateFields().catch(() => null);
    if (!values || !allowlistClient) return;
    try {
      await apiClientApi.updateModelAllowlist(allowlistClient.apiKey, values.modelAllowlist || []);
      message.success('模型白名单已更新');
      setAllowlistOpen(false);
      setAllowlistClient(null);
      fetchData(page, pageSize);
    } catch (err) {
      ErrorHandler.handleApiError(err, '更新失败');
    }
  };

  /** 打开用量图表弹窗 */
  const onShowUsageChart = (record: any) => {
    setUsageChartClient(record);
    setUsageChartOpen(true);
  };

  const columns = [
    {
      title: (
        <Tooltip title="请求头（如 X-API-Key）传入此值；与库中主键一致。旧版复合密钥为 apiKey + '.' + 随机后缀。">
          <span style={{ fontSize: 12, fontWeight: 500 }}>API Key</span>
        </Tooltip>
      ),
      dataIndex: 'apiKey',
      key: 'apiKey',
      fixed: 'left' as const,
      width: 220,
      ellipsis: true,
      render: (apiKey: string) =>
        apiKey ? (
          <Typography.Text
            copyable={{
              text: apiKey,
              icon: <CopyOutlined style={{ fontSize: 11 }} />,
            }}
            style={API_KEY_CELL_FONT}
          >
            {apiKey}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ ...API_KEY_CELL_FONT, fontSize: 11 }}>
            —
          </Typography.Text>
        ),
    },
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true, width: 120 },
    {
      title: '计费策略',
      dataIndex: 'billingPolicy',
      key: 'billingPolicy',
      width: 100,
      render: (val: string) => {
        const policy = val || 'internal';
        return (
          <Tag color={BILLING_POLICY_COLOR[policy] || 'default'}>
            {BILLING_POLICY_LABEL[policy] || policy}
          </Tag>
        );
      },
    },
    {
      title: '限流配置',
      key: 'rateLimits',
      width: 180,
      render: (_: unknown, r: any) => {
        const rl = r.rateLimits || {};
        const qps = rl.maxQps ?? 10;
        const concurrent = rl.maxConcurrent ?? 50;
        const daily = rl.maxDailyRequests ?? 10000;
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text style={{ fontSize: 12 }}>
              QPS: {qps} | 并发: {concurrent}
            </Typography.Text>
            <Typography.Text style={{ fontSize: 12 }}>
              日限额: {daily.toLocaleString()}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '模型白名单',
      key: 'modelAllowlist',
      width: 160,
      render: (_: unknown, r: any) => {
        const list: string[] = r.modelAllowlist || [];
        if (list.length === 0) {
          return <Tag color="default">全部允许</Tag>;
        }
        return (
          <Tooltip title={list.join(', ')}>
            <Tag color="blue">{list.length} 个模式</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '用量摘要',
      key: 'usageSummary',
      width: 160,
      render: (_: unknown, r: any) => {
        const summary = usageSummaryMap.get(r.apiKey);
        if (!summary) {
          return <Typography.Text type="secondary" style={{ fontSize: 12 }}>暂无数据</Typography.Text>;
        }
        const dailyRequests = summary.totalRequests ?? 0;
        const maxDaily = r.rateLimits?.maxDailyRequests ?? 10000;
        const pct = maxDaily > 0 ? Math.min(100, Math.round((dailyRequests / maxDaily) * 100)) : 0;
        return (
          <Space direction="vertical" size={4} style={{ minWidth: 140 }}>
            <Typography.Text style={{ fontSize: 12 }}>
              今日: {dailyRequests.toLocaleString()} / {maxDaily.toLocaleString()} 次
            </Typography.Text>
            <Progress
              percent={pct}
              size="small"
              status={pct >= 100 ? 'exception' : pct >= 80 ? 'active' : 'normal'}
              showInfo={false}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              今日费用约 ¥{(summary.totalCost ?? 0).toFixed(2)}
            </Typography.Text>
            <RateLimitStatusTag dailyRequests={dailyRequests} maxDailyRequests={maxDaily} />
          </Space>
        );
      },
    },
    {
      title: '默认优先级',
      dataIndex: 'defaultPriority',
      key: 'defaultPriority',
      width: 100,
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
      width: 70,
      render: (_: unknown, r: any) => (
        <Switch
          disabled={!canUpdateClient}
          checked={r.enabled !== false}
          onChange={(v) => onToggle(r, v)}
          size="small"
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 360,
      render: (_: unknown, r: any) => (
        <Space wrap>
          {canUpdateClient && (
            <>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEditRateLimits(r)}>
                限流
              </Button>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEditAllowlist(r)}>
                白名单
              </Button>
              <Button type="link" size="small" onClick={() => onEditPriority(r)}>
                优先级
              </Button>
              <Button type="link" size="small" onClick={() => onEditBillingPolicy(r)}>
                计费
              </Button>
              {r.plainCredentialOnly ? (
                <Tooltip title="密钥与 apiKey 相同，无法轮换。请新建客户端以更换凭据。">
                  <span>
                    <Button type="link" size="small" icon={<KeyOutlined />} disabled>
                      轮换
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => onRotate(r.apiKey)}>
                  轮换
                </Button>
              )}
            </>
          )}
          <Button type="link" size="small" icon={<BarChartOutlined />} onClick={() => onShowUsageChart(r)}>
            用量
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={pageTitle}
        leftExtra={
          canCreateClient ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新建
            </Button>
          ) : undefined
        }
        extra={(
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              fetchData(page, pageSize);
              fetchUsageSummary();
            }}
          >
            刷新
          </Button>
        )}
      />
      <Card>
        <Table
          rowKey="apiKey"
          columns={columns}
          dataSource={items}
          loading={loading}
          size="small"
          scroll={{ x: 1720 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (p, ps) => fetchData(p, ps || pageSize),
          }}
        />
      </Card>

      {/* 新建客户端弹窗 */}
      <Modal
        title="新建 API 客户端"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        onOk={onCreate}
        confirmLoading={creating}
        destroyOnClose
        width={600}
      >
        <Form form={form} layout="vertical" initialValues={{ billingPolicy: 'internal', defaultPriority: 50 }}>
          <Form.Item name="name" label="显示名称（可选）">
            <Input placeholder="例如：AGI-Content 生产" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="billingPolicy"
            label="计费策略"
            rules={[{ required: true, message: '请选择计费策略' }]}
          >
            <Select options={BILLING_POLICY_OPTIONS} placeholder="请选择计费策略" />
          </Form.Item>
          <Form.Item
            name="defaultPriority"
            label="默认优先级（0=最高, 100=最低）"
            rules={[{ required: true, message: '请输入优先级' }]}
          >
            <InputNumber min={0} max={100} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            限流配置（可选，留空使用默认值）
          </Typography.Text>
          <Form.Item name="maxQps" label="每秒最大请求数 (QPS)">
            <InputNumber min={1} max={10000} precision={0} style={{ width: '100%' }} placeholder="默认 10" />
          </Form.Item>
          <Form.Item name="maxConcurrent" label="最大并发任务数">
            <InputNumber min={1} max={10000} precision={0} style={{ width: '100%' }} placeholder="默认 50" />
          </Form.Item>
          <Form.Item name="maxDailyRequests" label="每日最大请求数">
            <InputNumber min={1} max={10000000} precision={0} style={{ width: '100%' }} placeholder="默认 10000" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑默认优先级弹窗 */}
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

      {/* 计费策略编辑弹窗 */}
      <Modal
        title="编辑计费策略"
        open={billingPolicyOpen}
        onCancel={() => { setBillingPolicyOpen(false); setBillingPolicyClient(null); }}
        onOk={onSaveBillingPolicy}
        destroyOnClose
      >
        <Form form={billingPolicyForm} layout="vertical">
          <Form.Item
            name="billingPolicy"
            label="计费策略"
            rules={[{ required: true, message: '请选择计费策略' }]}
          >
            <Select options={BILLING_POLICY_OPTIONS} placeholder="请选择计费策略" />
          </Form.Item>
          <Typography.Text type="secondary">
            internal：内部计费，走钱包扣费链路；external：仅记录用量，不扣费；exempt：完全免计费
          </Typography.Text>
        </Form>
      </Modal>

      {/* 限流配置编辑弹窗 */}
      <Modal
        title={`编辑限流配置 - ${rateLimitClient?.name || rateLimitClient?.apiKey || ''}`}
        open={rateLimitOpen}
        onCancel={() => { setRateLimitOpen(false); setRateLimitClient(null); }}
        onOk={onSaveRateLimits}
        destroyOnClose
      >
        <Form form={rateLimitForm} layout="vertical">
          <Form.Item
            name="maxQps"
            label="每秒最大请求数 (QPS)"
            rules={[{ required: true, message: '请输入 QPS 限制' }]}
          >
            <InputNumber min={1} max={10000} precision={0} style={{ width: '100%' }} placeholder="默认 10" />
          </Form.Item>
          <Form.Item
            name="maxConcurrent"
            label="最大并发任务数"
            rules={[{ required: true, message: '请输入并发限制' }]}
          >
            <InputNumber min={1} max={10000} precision={0} style={{ width: '100%' }} placeholder="默认 50" />
          </Form.Item>
          <Form.Item
            name="maxDailyRequests"
            label="每日最大请求数"
            rules={[{ required: true, message: '请输入每日限额' }]}
          >
            <InputNumber min={1} max={10000000} precision={0} style={{ width: '100%' }} placeholder="默认 10000" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 模型白名单编辑弹窗 */}
      <Modal
        title={`编辑模型白名单 - ${allowlistClient?.name || allowlistClient?.apiKey || ''}`}
        open={allowlistOpen}
        onCancel={() => { setAllowlistOpen(false); setAllowlistClient(null); setSelectedFeatureType(null); }}
        onOk={onSaveAllowlist}
        destroyOnClose
        width={600}
      >
        <Form form={allowlistForm} layout="vertical">
          <Form.Item label="功能类型筛选">
            <Select
              allowClear
              placeholder="选择功能类型筛选模型（留空显示所有）"
              options={FEATURE_TYPE_OPTIONS}
              value={selectedFeatureType}
              onChange={onFeatureTypeChange}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            name="modelAllowlist"
            label="模型白名单"
            extra="留空表示允许所有模型。支持通配符模式，如 wavespeed-ai/* 匹配该厂商下所有模型。"
          >
            <Select
              mode="tags"
              placeholder="输入模型名称或通配符模式，按回车添加"
              style={{ width: '100%' }}
              loading={loadingModels}
              options={availableModels.map((m) => ({ label: m, value: m }))}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
              }
              tokenSeparators={[',']}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 用量图表弹窗 */}
      <Modal
        title={`用量趋势 - ${usageChartClient?.name || usageChartClient?.apiKey || ''}`}
        open={usageChartOpen}
        onCancel={() => { setUsageChartOpen(false); setUsageChartClient(null); }}
        footer={null}
        width={700}
        destroyOnClose
      >
        {usageChartClient && <UsageChart apiKey={usageChartClient.apiKey} />}
      </Modal>
    </div>
  );
}
