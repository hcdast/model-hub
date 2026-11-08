import Table from '../components/AdminTable';
import { useEffect, useState, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Card, Button, Space, Typography, Switch, message, Modal, Form, Input, InputNumber, Tag, Select, Tooltip,
  Progress, Alert, Empty,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, KeyOutlined, EditOutlined, BarChartOutlined,
} from '@ant-design/icons';
import ReactECharts from '../components/Chart';
import dayjs from 'dayjs';
import { apiClientApi, modelApi } from '../services/api';
import { ErrorHandler } from '../utils/error-handler';
import { usePermission } from '../hooks/usePermission';
import PageHeader from '../components/PageHeader';
import { useRequest } from '../hooks/useRequest';
import { useFormDialog } from '../hooks/useFormDialog';
import { useUnsavedNavigation } from '../hooks/useUnsavedNavigation';

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
function UsageChart({ clientId }: { clientId: string }) {
  const { data: usageData = [], loading, error, refresh } = useRequest<any[]>(async () => {
    const res: any = await apiClientApi.getUsage(clientId, { from: dayjs().subtract(6, 'day').format('YYYYMMDD'), to: dayjs().format('YYYYMMDD') });
    return res.data || [];
  }, { deps: [clientId] });

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

  if (error) return <Alert type="error" showIcon message="用量数据加载失败" description="当前无法确认实际用量，请重试。" action={<Button onClick={() => void refresh()}>重试</Button>} />;
  if (!usageData.length) return <Empty description="该时段暂无用量记录" />;

  return (
    <><Typography.Paragraph type="secondary">此处仅统计请求量，费用请以计费记录为准。</Typography.Paragraph><ReactECharts
      option={chartOption}
      style={{ height: 240 }}
      notMerge
      lazyUpdate
    /></>
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
  const [summaryError, setSummaryError] = useState(false);
  const [modelsError, setModelsError] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const listSequence = useRef(0), modelSequence = useRef(0), summarySequence = useRef(0);
  const toggleLocks = useRef(new Set<string>());
  const [toggling, setToggling] = useState<string[]>([]);
  const reviewSequence = useRef(0);
  const reviewDialog = useRef<ReturnType<typeof Modal.confirm> | null>(null);
  const editorKey = priorityOpen ? `priority:${editingClient?.id}` : billingPolicyOpen ? `billing:${billingPolicyClient?.id}` : rateLimitOpen ? `rate:${rateLimitClient?.id}` : allowlistOpen ? `allow:${allowlistClient?.id}` : '';
  const activeEditor = useRef(editorKey);
  activeEditor.current = editorKey;
  useEffect(() => () => {
    reviewSequence.current++;
    reviewDialog.current?.destroy(); reviewDialog.current = null;
  }, [editorKey]);
  const createDialog = useFormDialog(createOpen, form, creating, () => { setCreateOpen(false); form.resetFields(); });
  const priorityDialog = useFormDialog(priorityOpen, priorityForm, false, () => { setPriorityOpen(false); setEditingClient(null); setConflict(null); });
  const billingDialog = useFormDialog(billingPolicyOpen, billingPolicyForm, false, () => { setBillingPolicyOpen(false); setBillingPolicyClient(null); setConflict(null); });
  const rateDialog = useFormDialog(rateLimitOpen, rateLimitForm, false, () => { setRateLimitOpen(false); setRateLimitClient(null); setConflict(null); });
  const allowDialog = useFormDialog(allowlistOpen, allowlistForm, false, () => { setAllowlistOpen(false); setAllowlistClient(null); setSelectedFeatureType(null); setConflict(null); modelSequence.current++; });
  useUnsavedNavigation(createDialog.dirty || priorityDialog.dirty || billingDialog.dirty || rateDialog.dirty || allowDialog.dirty);

  const fetchData = async (p = page, ps = pageSize) => {
    const request = ++listSequence.current;
    setLoading(true);
    try {
      const res: any = await apiClientApi.list({ page: p, pageSize: ps });
      if (request !== listSequence.current) return;
      setItems(res.data?.items || []);
      setTotal(res.data?.total ?? 0);
      setPage(res.data?.page ?? p);
      setPageSize(res.data?.pageSize ?? ps);
    } catch (err) {
      if (request === listSequence.current) ErrorHandler.handleApiError(err, '加载失败');
    }
    if (request === listSequence.current) setLoading(false);
  };

  /** 获取用量汇总 */
  const fetchUsageSummary = async () => {
    const request = ++summarySequence.current;
    setSummaryError(false);
    try {
      const res: any = await apiClientApi.getUsageSummary();
      if (request !== summarySequence.current) return;
      const summaryList: any[] = res.data || [];
      const map = new Map<string, any>();
      summaryList.forEach((item: any) => {
        map.set(item.id, item);
      });
      setUsageSummaryMap(map);
    } catch {
      if (request === summarySequence.current) setSummaryError(true);
    }
  };

  /** 获取可用模型列表（用于白名单自动补全） */
  const fetchAvailableModels = async (modelTypeFilter?: string) => {
    const request = ++modelSequence.current;
    setLoadingModels(true);
    setModelsError(false);
    setAvailableModels([]);
    try {
      const names = new Set<string>();
      let loaded = 0;
      for (let p = 1; ; p++) {
        const res: any = await modelApi.list({ page: p, pageSize: 100, ...(modelTypeFilter ? { model_type: modelTypeFilter } : {}) });
        if (request !== modelSequence.current) return;
        const rows: any[] = res.data?.items || [];
        rows.forEach(row => { if (row.model_id || row.name) names.add(row.model_id || row.name); });
        loaded += rows.length;
        if (!rows.length || loaded >= (res.data?.total ?? loaded)) break;
      }
      setAvailableModels([...names]);
    } catch {
      if (request === modelSequence.current) setModelsError(true);
    }
    if (request === modelSequence.current) setLoadingModels(false);
  };

  useEffect(() => {
    fetchData(1, pageSize);
    fetchUsageSummary();
    return () => { listSequence.current++; modelSequence.current++; summarySequence.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveError = (err: any) => {
    if (err?.response?.status === 409) { setConflict('配置已被其他管理员修改。当前输入已保留，请查看最新配置后重新确认。'); return; }
    if (!err?.errorFields) ErrorHandler.handleApiError(err, '更新失败');
  };
  const reviewLatest = async (record: any, editor: any, setRecord: (value: any) => void, fields: string[], resetBaseline: () => void) => {
    const request = ++reviewSequence.current, target = activeEditor.current;
    const isCurrent = () => request === reviewSequence.current && target === activeEditor.current;
    try {
      const res: any = await apiClientApi.detail(record.id);
      if (!isCurrent()) return;
      const latest = res.data;
      const next = fields.includes('maxQps') ? { maxQps: latest.rateLimits?.maxQps ?? 10, maxConcurrent: latest.rateLimits?.maxConcurrent ?? 50, maxDailyRequests: latest.rateLimits?.maxDailyRequests ?? 10000 }
        : Object.fromEntries(fields.map(key => [key, latest[key] ?? (key === 'modelAllowlist' ? [] : key === 'defaultPriority' ? 50 : 'internal')]));
      reviewDialog.current?.destroy();
      reviewDialog.current = Modal.confirm({ title: '对比最新配置', width: 620, content: <><Typography.Paragraph>加载后会替换当前输入，请核对后再保存。</Typography.Paragraph><strong>当前编辑</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(editor.getFieldsValue(), null, 2)}</pre><strong>最新配置</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(next, null, 2)}</pre></>, okText: '加载最新配置', cancelText: '保留当前输入', onOk: () => { if (!isCurrent()) return; editor.setFieldsValue(next); setRecord(latest); setConflict(null); resetBaseline(); } });
    } catch (err) { if (isCurrent()) ErrorHandler.handleApiError(err, '加载最新配置失败'); }
  };
  const conflictNotice = (record: any, editor: any, setRecord: (value: any) => void, fields: string[], dialog: ReturnType<typeof useFormDialog>) => conflict && <Alert style={{ marginBottom: 16 }} type="warning" showIcon message={conflict} action={<Button loading={dialog.busy} onClick={() => void dialog.run(() => reviewLatest(record, editor, setRecord, fields, dialog.resetBaseline))}>查看最新配置</Button>} />;

  const onCreate = () => createDialog.run(async () => {
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
              请在网关或客户端的 API Key 请求头（如 X-API-Key）中使用该值。
            </Typography.Text>
            <Typography.Text type="secondary">关闭后将无法再次查看完整密钥；列表仅显示掩码。</Typography.Text>
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
  });

  const onRotate = (clientId: string) => {
    Modal.confirm({
      title: '轮换密钥？',
      content: '旧密钥将立即失效，请保存新密钥。',
      onOk: async () => {
        try {
          const res: any = await apiClientApi.rotate(clientId);
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
    if (toggleLocks.current.has(record.id)) return;
    toggleLocks.current.add(record.id); setToggling([...toggleLocks.current]);
    try {
      await apiClientApi.setEnabled(record.id, enabled, record.revision ?? 0);
      message.success(enabled ? '已启用' : '已禁用');
      fetchData(page, pageSize);
    } catch (err) {
      ErrorHandler.handleApiError(err, '更新失败，请刷新列表后重试');
      void fetchData();
    } finally {
      toggleLocks.current.delete(record.id); setToggling([...toggleLocks.current]);
    }
  };

  const onEditPriority = (record: any) => {
    setConflict(null);
    setEditingClient(record);
    priorityForm.setFieldsValue({ defaultPriority: record.defaultPriority ?? 50 });
    setPriorityOpen(true);
  };

  const onSavePriority = () => priorityDialog.run(async () => {
    const values = await priorityForm.validateFields().catch(() => null);
    if (!values || !editingClient) return;
    try {
      await apiClientApi.updateDefaultPriority(editingClient.id, values.defaultPriority, editingClient.revision ?? 0);
      message.success('默认优先级已更新');
      setPriorityOpen(false);
      setEditingClient(null);
      fetchData(page, pageSize);
    } catch (err) {
      handleSaveError(err);
    }
  });

  /** 打开计费策略编辑弹窗 */
  const onEditBillingPolicy = (record: any) => {
    setConflict(null);
    setBillingPolicyClient(record);
    billingPolicyForm.setFieldsValue({ billingPolicy: record.billingPolicy ?? 'internal' });
    setBillingPolicyOpen(true);
  };

  /** 保存计费策略 */
  const onSaveBillingPolicy = () => billingDialog.run(async () => {
    const values = await billingPolicyForm.validateFields().catch(() => null);
    if (!values || !billingPolicyClient) return;
    try {
      await apiClientApi.updateBillingPolicy(billingPolicyClient.id, values.billingPolicy, billingPolicyClient.revision ?? 0);
      message.success('计费策略已更新');
      setBillingPolicyOpen(false);
      setBillingPolicyClient(null);
      fetchData(page, pageSize);
    } catch (err) {
      handleSaveError(err);
    }
  });

  /** 打开限流配置编辑弹窗 */
  const onEditRateLimits = (record: any) => {
    setConflict(null);
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
  const onSaveRateLimits = () => rateDialog.run(async () => {
    const values = await rateLimitForm.validateFields().catch(() => null);
    if (!values || !rateLimitClient) return;
    try {
      await apiClientApi.updateRateLimits(rateLimitClient.id, {
        maxQps: values.maxQps,
        maxConcurrent: values.maxConcurrent,
        maxDailyRequests: values.maxDailyRequests,
      }, rateLimitClient.revision ?? 0);
      message.success('限流配置已更新');
      setRateLimitOpen(false);
      setRateLimitClient(null);
      fetchData(page, pageSize);
    } catch (err) {
      handleSaveError(err);
    }
  });

  /** 打开模型白名单编辑弹窗 */
  const onEditAllowlist = (record: any) => {
    setConflict(null);
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
  const onSaveAllowlist = () => allowDialog.run(async () => {
    const values = await allowlistForm.validateFields().catch(() => null);
    if (!values || !allowlistClient) return;
    try {
      await apiClientApi.updateModelAllowlist(allowlistClient.id, values.modelAllowlist || [], allowlistClient.revision ?? 0);
      message.success('模型白名单已更新');
      setAllowlistOpen(false);
      setAllowlistClient(null);
      fetchData(page, pageSize);
    } catch (err) {
      handleSaveError(err);
    }
  });

  /** 打开用量图表弹窗 */
  const onShowUsageChart = (record: any) => {
    setUsageChartClient(record);
    setUsageChartOpen(true);
  };

  const columns = [
    {
      title: (
        <Tooltip title="完整调用凭据仅在创建成功时返回一次；列表只显示不可用于认证的掩码。">
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
          <Typography.Text style={API_KEY_CELL_FONT}>
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
      title: '来源',
      key: 'source',
      width: 100,
      render: (_: unknown, r: any) => {
        if (r.source === 'portal') {
          return (
            <Tooltip title={r.portalUser ? `${r.portalUser.email} (${r.portalUser.username})` : 'Portal 用户'}>
              <Tag color="blue">Portal</Tag>
            </Tooltip>
          );
        }
        return <Tag color="green">管理后台</Tag>;
      },
    },
    {
      title: '关联用户',
      key: 'portalUser',
      width: 120,
      ellipsis: true,
      render: (_: unknown, r: any) => {
        if (r.source === 'portal' && r.portalUser) {
          return (
            <Tooltip title={r.portalUser.email}>
              <span>{r.portalUser.username || r.portalUser.email}</span>
            </Tooltip>
          );
        }
        return <span style={{ color: '#999' }}>—</span>;
      },
    },
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
        const summary = usageSummaryMap.get(r.id);
        if (summaryError) return <Typography.Text type="danger">用量加载失败</Typography.Text>;
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
              费用请以计费记录为准
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
          loading={toggling.includes(r.id)}
          disabled={!canUpdateClient || r.source === 'portal'}
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
          {canUpdateClient && r.source === 'admin' && (
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
                <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => onRotate(r.id)}>
                  轮换
                </Button>
              )}
            </>
          )}
          {r.source === 'admin' && (
            <Button type="link" size="small" icon={<BarChartOutlined />} onClick={() => onShowUsageChart(r)}>
              用量
            </Button>
          )}
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
        {...createDialog.modalProps}
        onOk={onCreate}
        destroyOnClose
        width={600}
      >
        <Form disabled={createDialog.busy} form={form} layout="vertical" initialValues={{ billingPolicy: 'internal', defaultPriority: 50 }}>
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
            <InputNumber min={1} max={1000} precision={0} style={{ width: '100%' }} placeholder="默认 10" />
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
        {...priorityDialog.modalProps}
        onOk={onSavePriority}
        destroyOnClose
      >
        {conflictNotice(editingClient, priorityForm, setEditingClient, ['defaultPriority'], priorityDialog)}
        <Form disabled={priorityDialog.busy} form={priorityForm} layout="vertical">
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
        {...billingDialog.modalProps}
        onOk={onSaveBillingPolicy}
        destroyOnClose
      >
        {conflictNotice(billingPolicyClient, billingPolicyForm, setBillingPolicyClient, ['billingPolicy'], billingDialog)}
        <Form disabled={billingDialog.busy} form={billingPolicyForm} layout="vertical">
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
        {...rateDialog.modalProps}
        onOk={onSaveRateLimits}
        destroyOnClose
      >
        {conflictNotice(rateLimitClient, rateLimitForm, setRateLimitClient, ['maxQps', 'maxConcurrent', 'maxDailyRequests'], rateDialog)}
        <Form disabled={rateDialog.busy} form={rateLimitForm} layout="vertical">
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
        {...allowDialog.modalProps}
        onOk={onSaveAllowlist}
        destroyOnClose
        width={600}
      >
        {conflictNotice(allowlistClient, allowlistForm, setAllowlistClient, ['modelAllowlist'], allowDialog)}
        <Form disabled={allowDialog.busy} form={allowlistForm} layout="vertical">
          {modelsError && <Alert style={{ marginBottom: 12 }} type="error" showIcon message="模型候选加载失败" description="已选白名单已保留，可重试加载候选。" action={<Button onClick={() => void fetchAvailableModels(selectedFeatureType || undefined)}>重试</Button>} />}
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
        {usageChartClient && <UsageChart clientId={usageChartClient.id} />}
      </Modal>
    </div>
  );
}
