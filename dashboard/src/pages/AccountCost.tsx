import { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Space, Typography, DatePicker, Select, Row, Col, Statistic, Tag, message,
} from 'antd';
import dayjs from 'dayjs';
import ReactEChartsCore from 'echarts-for-react';
import { accountCostApi, accountPoolApi, providerConfigApi } from '../services/api';

interface DailyCostRow {
  _id?: string;
  account_id: string;
  provider_name: string;
  date: string;
  total_cost: number;
  request_count: number;
  success_count: number;
  failure_count: number;
  avg_latency_ms: number;
}

interface MonthlySummary {
  account_id: string;
  provider_name: string;
  month: string;
  total_cost: number;
  total_requests: number;
  total_success: number;
  total_failure: number;
  avg_latency_ms: number;
  days: number;
}

interface AccountInfo {
  _id: string;
  provider_name: string;
  account_alias: string;
}

export default function AccountCostPage() {
  const [dailyData, setDailyData] = useState<DailyCostRow[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlySummary[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[string, string]>([
    dayjs().subtract(7, 'day').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);
  const [filterProvider, setFilterProvider] = useState<string | undefined>();
  const [filterAccount, setFilterAccount] = useState<string | undefined>();

  const [providerConfigs, setProviderConfigs] = useState<{ provider_name: string }[]>([]);

  // Load account list for alias mapping + provider configs for filter dropdown
  useEffect(() => {
    (async () => {
      try {
        const res: any = await accountPoolApi.list({ pageSize: 100 });
        setAccounts(res.data?.items || []);
      } catch { /* ignore */ }
    })();
    (async () => {
      try {
        const res: any = await providerConfigApi.list();
        setProviderConfigs(res.data?.items || []);
      } catch { /* ignore */ }
    })();
  }, []);

  const accountAliasMap = new Map(accounts.map((a) => [a._id, a.account_alias]));
  const providerNames = [
    ...new Set([
      ...providerConfigs.map((p) => p.provider_name),
      ...accounts.map((a) => a.provider_name),
    ]),
  ].sort();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        start_date: dateRange[0],
        end_date: dateRange[1],
        pageSize: 100,
      };
      if (filterProvider) params.provider_name = filterProvider;
      if (filterAccount) params.account_id = filterAccount;

      const monthParam: Record<string, any> = {};
      if (filterProvider) monthParam.provider_name = filterProvider;
      if (filterAccount) monthParam.account_id = filterAccount;

      const [dailyRes, monthlyRes]: any[] = await Promise.all([
        accountCostApi.listDaily(params),
        accountCostApi.monthly(monthParam),
      ]);
      setDailyData(dailyRes.data?.items || []);
      setMonthlyData(monthlyRes.data?.items || []);
    } catch {
      message.error('加载成本数据失败');
    }
    setLoading(false);
  }, [dateRange, filterProvider, filterAccount]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Aggregate summary from monthly data
  const summary = monthlyData.reduce(
    (acc, r) => ({
      totalCost: acc.totalCost + (r.total_cost || 0),
      totalRequests: acc.totalRequests + (r.total_requests || 0),
      totalSuccess: acc.totalSuccess + (r.total_success || 0),
      totalFailure: acc.totalFailure + (r.total_failure || 0),
    }),
    { totalCost: 0, totalRequests: 0, totalSuccess: 0, totalFailure: 0 },
  );

  const successRate = summary.totalRequests > 0
    ? ((summary.totalSuccess / summary.totalRequests) * 100).toFixed(1)
    : '—';

  // Build chart data: cost trend by date
  const chartDates = [...new Set(dailyData.map((d) => d.date))].sort();
  const providerGroups = [...new Set(dailyData.map((d) => d.provider_name))];

  const costChartOption = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: providerGroups },
    xAxis: { type: 'category' as const, data: chartDates },
    yAxis: { type: 'value' as const, name: '成本' },
    series: providerGroups.map((pn) => ({
      name: pn,
      type: 'line' as const,
      smooth: true,
      data: chartDates.map((date) => {
        const rows = dailyData.filter((d) => d.date === date && d.provider_name === pn);
        return rows.reduce((s, r) => s + r.total_cost, 0);
      }),
    })),
  };

  const dailyColumns = [
    { title: '日期', dataIndex: 'date', width: 110 },
    { title: '厂商', dataIndex: 'provider_name', width: 130 },
    {
      title: '账号', dataIndex: 'account_id', width: 150,
      render: (id: string) => accountAliasMap.get(id) || id?.slice(-6) || '—',
    },
    {
      title: '成本', dataIndex: 'total_cost', width: 100,
      sorter: (a: DailyCostRow, b: DailyCostRow) => a.total_cost - b.total_cost,
      render: (v: number) => `¥${v.toFixed(4)}`,
    },
    { title: '请求数', dataIndex: 'request_count', width: 80 },
    { title: '成功', dataIndex: 'success_count', width: 80 },
    { title: '失败', dataIndex: 'failure_count', width: 80 },
    {
      title: '成功率', key: 'rate', width: 90,
      render: (_: unknown, r: DailyCostRow) =>
        r.request_count > 0 ? `${((r.success_count / r.request_count) * 100).toFixed(1)}%` : '—',
    },
    {
      title: '平均延迟', dataIndex: 'avg_latency_ms', width: 100,
      render: (v: number) => v ? `${Math.round(v)}ms` : '—',
    },
  ];

  const monthlyColumns = [
    { title: '厂商', dataIndex: 'provider_name', width: 130 },
    {
      title: '账号', dataIndex: 'account_id', width: 150,
      render: (id: string) => accountAliasMap.get(id) || id?.slice(-6) || '—',
    },
    {
      title: '月成本', dataIndex: 'total_cost', width: 110,
      sorter: (a: MonthlySummary, b: MonthlySummary) => a.total_cost - b.total_cost,
      render: (v: number) => `¥${v.toFixed(4)}`,
    },
    { title: '总请求', dataIndex: 'total_requests', width: 90 },
    { title: '成功', dataIndex: 'total_success', width: 80 },
    { title: '失败', dataIndex: 'total_failure', width: 80 },
    {
      title: '成功率', key: 'rate', width: 90,
      render: (_: unknown, r: MonthlySummary) =>
        r.total_requests > 0
          ? <Tag color={r.total_failure / r.total_requests > 0.1 ? 'error' : 'success'}>
              {((r.total_success / r.total_requests) * 100).toFixed(1)}%
            </Tag>
          : '—',
    },
    {
      title: '平均延迟', dataIndex: 'avg_latency_ms', width: 100,
      render: (v: number) => v ? `${Math.round(v)}ms` : '—',
    },
    { title: '天数', dataIndex: 'days', width: 60 },
  ];

  return (
    <div>
      <Typography.Title level={4}>账号成本观测</Typography.Title>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          <Col span={6}><Statistic title="本月总成本" value={summary.totalCost} precision={4} prefix="¥" /></Col>
          <Col span={6}><Statistic title="总请求" value={summary.totalRequests} /></Col>
          <Col span={6}><Statistic title="成功率" value={successRate} suffix="%" valueStyle={{ color: '#52c41a' }} /></Col>
          <Col span={6}><Statistic title="失败数" value={summary.totalFailure} valueStyle={{ color: '#ff4d4f' }} /></Col>
        </Row>
      </Card>

      <Card title="成本趋势" style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 16 }} wrap>
          <DatePicker.RangePicker
            value={[dayjs(dateRange[0]), dayjs(dateRange[1])]}
            onChange={(_, ds) => { if (ds[0] && ds[1]) setDateRange([ds[0], ds[1]]); }}
          />
          <Select
            placeholder="按厂商筛选" allowClear style={{ width: 180 }}
            options={providerNames.map((p) => ({ label: p, value: p }))}
            value={filterProvider}
            onChange={setFilterProvider}
          />
          <Select
            placeholder="按账号筛选" allowClear style={{ width: 200 }}
            options={accounts
              .filter((a) => !filterProvider || a.provider_name === filterProvider)
              .map((a) => ({ label: `${a.account_alias} (${a.provider_name})`, value: a._id }))}
            value={filterAccount}
            onChange={setFilterAccount}
          />
        </Space>
        {chartDates.length > 0 ? (
          <ReactEChartsCore option={costChartOption} style={{ height: 300 }} />
        ) : (
          <Typography.Text type="secondary">暂无数据</Typography.Text>
        )}
      </Card>

      <Card title="月度汇总" style={{ marginBottom: 16 }}>
        <Table<MonthlySummary>
          rowKey={(r) => `${r.account_id}-${r.provider_name}`}
          loading={loading}
          dataSource={monthlyData}
          columns={monthlyColumns}
          pagination={false}
          size="small"
        />
      </Card>

      <Card title="日明细">
        <Table<DailyCostRow>
          rowKey={(r) => `${r.account_id}-${r.date}`}
          loading={loading}
          dataSource={dailyData}
          columns={dailyColumns}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          size="small"
        />
      </Card>
    </div>
  );
}
