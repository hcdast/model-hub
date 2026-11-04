import { useRequest } from '../hooks/useRequest';
import { useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Typography, DatePicker, Select, Row, Col, Statistic, Tag, message, Button,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import dayjs from 'dayjs';
import ReactEChartsCore from '../components/Chart';
import { accountCostApi, accountPoolApi } from '../services/api';
import ProviderSelect from '../components/ProviderSelect';

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
  const [search, setSearch] = useSearchParams();
  const page = Number(search.get('page')) || 1;
  const dateRange: [string, string] = [search.get('start_date') || dayjs().subtract(7, 'day').format('YYYY-MM-DD'), search.get('end_date') || dayjs().format('YYYY-MM-DD')];
  const filterProvider = search.get('provider_name') || undefined, filterAccount = search.get('account_id') || undefined;
  const update = (patch: Record<string, any>) => { const next = new URLSearchParams(search); Object.entries({ page: 1, ...patch } as Record<string, any>).forEach(([k,v]) => v === undefined || v === '' ? next.delete(k) : next.set(k, String(v))); setSearch(next); };
  const setPage = (p: number) => update({ page: p });
  const setFilterProvider = (v?: string) => update({ provider_name: v, account_id: undefined });
  const setFilterAccount = (v?: string) => update({ account_id: v });
  const setDateRange = (v: [string, string]) => update({ start_date: v[0], end_date: v[1] });
  const { data: accounts = [] } = useRequest<AccountInfo[]>(async () => {
    const rows: AccountInfo[] = []; for (let p = 1; ; p++) { const r: any = await accountPoolApi.list({ page: p, pageSize: 100 }); rows.push(...r.data.items); if (!r.data.items.length || rows.length >= r.data.total) break; } return rows;
  });
  const accountAliasMap = new Map(accounts.map(a => [a._id, a.account_alias]));
  const { data, loading, refresh: fetchData } = useRequest<any>(async () => { const params = { start_date: dateRange[0], end_date: dateRange[1], provider_name: filterProvider, account_id: filterAccount }; const [daily, summary]: any[] = await Promise.all([accountCostApi.listDaily({ ...params, page, pageSize: 20 }), accountCostApi.summary(params)]); return { daily: daily.data, summary: summary.data }; }, { deps: [search.toString()] });
  const dailyData: DailyCostRow[] = data?.daily?.items || [], total = data?.daily?.total || 0;
  const monthlyData: MonthlySummary[] = data?.summary?.items || [], trendData: DailyCostRow[] = data?.summary?.trend || [];

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
  const chartDates = [...new Set(trendData.map((d) => d.date))].sort();
  const providerGroups = [...new Set(trendData.map((d) => d.provider_name))];

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
        const rows = trendData.filter((d) => d.date === date && d.provider_name === pn);
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
      render: (v: number) => `${v.toFixed(2)}（供应商成本单位）`,
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
      title: '期间成本', dataIndex: 'total_cost', width: 110,
      sorter: (a: MonthlySummary, b: MonthlySummary) => a.total_cost - b.total_cost,
      render: (v: number) => `${v.toFixed(2)}（供应商成本单位）`,
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
      <PageHeader
        title="成本分析"
        extra={(
          <>
            <DatePicker.RangePicker
              value={[dayjs(dateRange[0]), dayjs(dateRange[1])]}
              onChange={(_, ds) => {
                if (ds[0] && ds[1]) { setDateRange([ds[0], ds[1]]); }
              }}
            />
            <ProviderSelect
              style={{ width: 180 }}
              value={filterProvider}
              onChange={(v) => { setFilterProvider(v); }}
            />
            <Select
              placeholder="按账号筛选"
              allowClear
              style={{ width: 200 }}
              options={accounts
                .filter((a) => !filterProvider || a.provider_name === filterProvider)
                .map((a) => ({ label: `${a.account_alias} (${a.provider_name})`, value: a._id }))}
              value={filterAccount}
              onChange={(v) => { setFilterAccount(v); }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void fetchData()} loading={loading}>
              刷新
            </Button>
          </>
        )}
      />

      <Typography.Paragraph type="secondary">日期按 UTC 统计；汇总和趋势覆盖所选期间全部记录。暂无数据表示该期间未采集账号成本。</Typography.Paragraph>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          <Col span={6}><Statistic title="所选期间总成本" value={summary.totalCost} precision={2} suffix="成本单位" /></Col>
          <Col span={6}><Statistic title="总请求" value={summary.totalRequests} /></Col>
          <Col span={6}><Statistic title="成功率" value={successRate} suffix="%" valueStyle={{ color: '#52c41a' }} /></Col>
          <Col span={6}><Statistic title="失败数" value={summary.totalFailure} valueStyle={{ color: '#ff4d4f' }} /></Col>
        </Row>
      </Card>

      <Card title="成本趋势" style={{ marginBottom: 16 }}>
        {chartDates.length > 0 ? (
          <ReactEChartsCore option={costChartOption} style={{ height: 300 }} />
        ) : (
          <Typography.Text type="secondary">暂无数据</Typography.Text>
        )}
      </Card>

      <Card title="所选期间账号汇总" style={{ marginBottom: 16 }}>
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
          pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
          size="small"
        />
      </Card>
    </div>
  );
}
