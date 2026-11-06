import Table from '../components/AdminTable';
import { useRequest } from '../hooks/useRequest';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, Tag, Typography, Button, Space, message, Spin, Drawer, Descriptions } from 'antd';
import { ReloadOutlined, HeartOutlined } from '@ant-design/icons';
import { providerHealthApi, type ProviderHealthOverview } from '../services/provider-health';
import ProviderHealthChart from '../components/ProviderHealthChart';
import CircuitBreakerOverrideModal from '../components/CircuitBreakerOverrideModal';
import { usePermission } from '../hooks/usePermission';
import PageHeader from '../components/PageHeader';

/** 熔断状态对应的颜色和文案 */
const circuitStateMap: Record<string, { color: string; label: string }> = {
  CLOSED: { color: 'default', label: '未熔断' },
  OPEN: { color: 'red', label: '熔断中' },
  HALF_OPEN: { color: 'orange', label: '恢复探测中' },
};

export default function ProviderHealthPage() {
  const { hasPermission } = usePermission();
  const [selected, setSelected] = useState<string>();
  const [details, setDetails] = useState<any>();
  const [override, setOverride] = useState(false);
  const inspect = async (provider: string) => { setSelected(provider); setDetails(undefined); try { const res:any = await providerHealthApi.getProviderHealth(provider); setDetails(res.data); } catch { message.error('加载详情失败'); } };
  const { data: items = [], loading, refresh: fetchData, lastSuccess, paused, setPaused } = useRequest<ProviderHealthOverview[]>(async () => { const res: any = await providerHealthApi.getOverview(); return res.data?.items || res.data || []; }, { pollingInterval: 10000 });
  useEffect(() => {
    if (selected && lastSuccess && !items.some(item => item.provider === selected)) {
      setSelected(undefined);
      setDetails(undefined);
      setOverride(false);
    }
  }, [items, selected, lastSuccess]);

  return (
    <div>
      <PageHeader
        title="供应商健康度"
        subtitle="仅展示已配置厂商，指标来自实际调用采样"
        prefix={<HeartOutlined style={{ color: '#eb2f96', fontSize: 20 }} />}
        extra={(
          <Space><span>上次成功：{lastSuccess?.toLocaleTimeString() || '—'}</span><Button onClick={() => setPaused(!paused)}>{paused ? '恢复自动刷新' : '暂停自动刷新'}</Button><Button icon={<ReloadOutlined />} onClick={() => void fetchData()} loading={loading}>
            刷新
          </Button></Space>
        )}
      />
      <Alert type="info" showIcon message="未熔断表示允许请求，不代表供应商健康；暂无样本时无法判断健康度。指标仅统计各供应商的滑动采样窗口。" style={{ marginBottom: 16 }} />
      <Card>
      {loading && items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" tip="加载中..." />
        </div>
      ) : (
        <Table<ProviderHealthOverview>
          rowKey="provider"
          dataSource={items}
          loading={loading && items.length > 0}
          pagination={false}
          columns={[
            {
              title: '供应商 / 采样窗口',
              dataIndex: 'provider',
              width: 160,
              render: (name: string, row) => <Space direction="vertical" size={0}><Typography.Text strong>{name}</Typography.Text><Typography.Text type="secondary">{row.windowDurationMs ? `最近 ${row.windowDurationMs / 60000} 分钟` : '窗口未提供'} · {row.sampleCount > 0 ? `${row.sampleCount} 个样本` : '暂无样本'}</Typography.Text></Space>,
            },
            {
              title: '熔断状态',
              dataIndex: 'circuitState',
              width: 130,
              render: (state: string, record) => {
                const info = circuitStateMap[state] || { color: 'default', label: state };
                return (
                  <Space>
                    <Tag color={info.color}>{info.label}</Tag>
                    {record.hasManualOverride && (
                      <Tag color="purple">手动覆盖</Tag>
                    )}
                  </Space>
                );
              },
            },
            {
              title: '成功率',
              dataIndex: 'successRate',
              width: 100,
              render: (val: number, row) =>
                row.sampleCount > 0 && val != null ? `${(val * 100).toFixed(1)}%` : '—',
            },
            {
              title: '错误率',
              dataIndex: 'errorRate',
              width: 100,
              render: (val: number, row) =>
                row.sampleCount > 0 && val != null ? `${(val * 100).toFixed(1)}%` : '—',
            },
            {
              title: '平均延迟',
              dataIndex: 'avgLatencyMs',
              width: 110,
              render: (val: number, row) =>
                row.sampleCount > 0 && val != null ? `${val.toFixed(0)} ms` : '—',
            },
            {
              title: '样本数',
              dataIndex: 'sampleCount',
              width: 90,
            },
            {
              title: '最后状态变更',
              dataIndex: 'lastTransitionAt',
              width: 180,
              render: (val: string) =>
                val ? new Date(val).toLocaleString() : '—',
            },
            { title: '详情', key: 'detail', width: 90, render: (_, row) => <Button type="link" onClick={() => inspect(row.provider)}>查看</Button> },
          ]}
        />
      )}
    </Card>
    <Drawer open={!!selected} title={`${selected} · 健康详情`} width={850} onClose={() => setSelected(undefined)}>
      {selected && <><Typography.Paragraph>指标为滑动窗口采样；暂无样本不代表失败。手动覆盖请在处理完成后恢复自动模式。</Typography.Paragraph>
      {details && <Descriptions column={1} items={[{key:'window',label:'采样窗口',children:`${details.metrics?.windowDurationMs || 0} ms`},{key:'computed',label:'采集时间',children:details.metrics?.computedAt || '—'}]} />}
      {hasPermission('provider:update') && <Button onClick={() => setOverride(true)}>管理熔断覆盖</Button>}
      <ProviderHealthChart provider={selected} />
      <CircuitBreakerOverrideModal open={override} provider={selected} manualOverride={details?.circuitBreaker?.manualOverride || null} onClose={() => setOverride(false)} onSuccess={() => { void fetchData(); void inspect(selected); }} /></>}
    </Drawer>
    </div>
  );
}
