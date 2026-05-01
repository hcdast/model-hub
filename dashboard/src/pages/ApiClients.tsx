import { useEffect, useState, useMemo } from 'react';
import {
  Table, Card, Button, Space, Typography, Switch, message, Modal, Form, Input, InputNumber, Tag, Select, Tooltip,
} from 'antd';
import { PlusOutlined, ReloadOutlined, KeyOutlined, EditOutlined, BarChartOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { apiClientApi, modelApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';

/** 计费策略颜色映射 */
const BILLING_POLICY_COLOR: Record<string, string> = {
  internal: 'blue',
  external: 'green',
  exempt: 'default',
};

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
function UsageChart({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false);
  const [usageData, setUsageData] = useState<any[]>([]);

  useEffect(() => {
    const fetchUsage = async () => {
      setLoading(true);
      try {
        const to = dayjs().format('YYYYMMDD');
        const from = dayjs().subtract(6, 'day').format('YYYYMMDD');
        const res: any = await apiClientApi.getUsage(clientId, { from, to });
        setUsageData(res.data || []);
      } catch {
        // 静默处理，图表区域显示空状态
        setUsageData([]);
      }
      setLoading(false);
    };
    fetchUsage();
  }, [clientId]);

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
    const dateLabels = dates.map((d) => `${d.slice(4, 6)}-${d.slice(6, 8)}`);

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['总请求', '成功', '失败'], bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dateLabels },
      yAxis: { type: 'value', name: '请求数', min: 0 },
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
        map.set(item.clientId, item);
      });
      setUsageSummaryMap(map);
    } catch {
      // 静默处理
    }
  };

  /** 获取可用模型列表（用于白名单自动补全） */
  const fetchAvailableModels = async () => {
    try {
      const res: any = await modelApi.list({ page: 1, pageSize: 200 });
      const modelItems: any[] = res.data?.items || [];
      const names = modelItems.map((m: any) => m.model_name || m.name).filter(Boolean);
      setAvailableModels(names);
    } catch {
      // 静默处理
    }
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
      const res: any = await apiClientApi.create({ name: values.name || undefined });
      const key = res.data?.apiKey;
      Modal.success({
        title: '请立即保存 API Key',
        width: 560,
        content: (
          <div>
            <Typography.Paragraph copyable={{ text: key }}><code>{key}</code></Typography.Paragraph>
            <Typography.Text type="secondary">关闭后将无法再次查看完整密钥。</Typography.Text>
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

  const onRotate = (clientId: string) => {
    Modal.confirm({
      title: '轮换密钥？',
      content: '旧密钥将立即失效，请保存新密钥。',
      onOk: async () => {
        try {
          const res: any = await apiClientApi.rotate(clientId);
          const key = res.data?.apiKey;
          Modal.success({
            title: '新 API Key',
            width: 560,
            content: (
              <Typography.Paragraph copyable={{ text: key }}><code>{key}</code></Typography.Paragraph>
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
      await apiClientApi.setEnabled(record.clientId, enabled);
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
      await apiClientApi.updateDefaultPriority(editingClient.clientId, values.defaultPriority);
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
      await apiClientApi.updateBillingPolicy(billingPolicyClient.clientId, values.billingPolicy);
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
      await apiClientApi.updateRateLimits(rateLimitClient.clientId, {
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
    setAllowlistOpen(true);
  };

  /** 保存模型白名单 */
  const onSaveAllowlist = async () => {
    const values = await allowlistForm.validateFields().catch(() => null);
    if (!values || !allowlistClient) return;
    try {
      await apiClientApi.updateModelAllowlist(allowlistClient.clientId, values.modelAllowlist || []);
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
    { title: 'clientId', dataIndex: 'clientId', key: 'clientId', ellipsis: true, width: 220 },
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
        const summary = usageSummaryMap.get(r.clientId);
        if (!summary) {
          return <Typography.Text type="secondary" style={{ fontSize: 12 }}>暂无数据</Typography.Text>;
        }
        const dailyRequests = summary.todayRequests ?? 0;
        const maxDaily = r.rateLimits?.maxDailyRequests ?? 10000;
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text style={{ fontSize: 12 }}>
              今日: {dailyRequests.toLocaleString()} 次
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
        <Switch checked={r.enabled !== false} onChange={(v) => onToggle(r, v)} size="small" />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 360,
      render: (_: unknown, r: any) => (
        <Space wrap>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEditRateLimits(r)}>
            限流
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEditAllowlist(r)}>
            白名单
          </Button>
          <Button type="link" size="small" icon={<BarChartOutlined />} onClick={() => onShowUsageChart(r)}>
            用量
          </Button>
          <Button type="link" size="small" onClick={() => onEditPriority(r)}>
            优先级
          </Button>
          <Button type="link" size="small" onClick={() => onEditBillingPolicy(r)}>
            计费
          </Button>
          <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => onRotate(r.clientId)}>
            轮换
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="API 客户端"
      extra={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchData(page, pageSize); fetchUsageSummary(); }}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建</Button>
        </Space>
      )}
    >
      <Table
        rowKey="clientId"
        columns={columns}
        dataSource={items}
        loading={loading}
        size="small"
        scroll={{ x: 1400 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => fetchData(p, ps || pageSize),
        }}
      />

      {/* 新建客户端弹窗 */}
      <Modal
        title="新建 API 客户端"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        onOk={onCreate}
        confirmLoading={creating}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="显示名称（可选）">
            <Input placeholder="例如：AGI-Content 生产" maxLength={200} />
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
        title={`编辑限流配置 - ${rateLimitClient?.name || rateLimitClient?.clientId || ''}`}
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
        title={`编辑模型白名单 - ${allowlistClient?.name || allowlistClient?.clientId || ''}`}
        open={allowlistOpen}
        onCancel={() => { setAllowlistOpen(false); setAllowlistClient(null); }}
        onOk={onSaveAllowlist}
        destroyOnClose
        width={600}
      >
        <Form form={allowlistForm} layout="vertical">
          <Form.Item
            name="modelAllowlist"
            label="模型白名单"
            extra="留空表示允许所有模型。支持通配符模式，如 wavespeed-ai/* 匹配该厂商下所有模型。"
          >
            <Select
              mode="tags"
              placeholder="输入模型名称或通配符模式，按回车添加"
              style={{ width: '100%' }}
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
        title={`用量趋势 - ${usageChartClient?.name || usageChartClient?.clientId || ''}`}
        open={usageChartOpen}
        onCancel={() => { setUsageChartOpen(false); setUsageChartClient(null); }}
        footer={null}
        width={700}
        destroyOnClose
      >
        {usageChartClient && <UsageChart clientId={usageChartClient.clientId} />}
      </Modal>
    </Card>
  );
}
