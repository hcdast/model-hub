import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Tag, Typography, Button, Space, message, Spin } from 'antd';
import { ReloadOutlined, HeartOutlined } from '@ant-design/icons';
import { providerHealthApi, type ProviderHealthOverview } from '../services/provider-health';
import PageHeader from '../components/PageHeader';

/** 熔断状态对应的颜色和文案 */
const circuitStateMap: Record<string, { color: string; label: string }> = {
  CLOSED: { color: 'green', label: 'CLOSED' },
  OPEN: { color: 'red', label: 'OPEN' },
  HALF_OPEN: { color: 'orange', label: 'HALF_OPEN' },
};

export default function ProviderHealthPage() {
  const [items, setItems] = useState<ProviderHealthOverview[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await providerHealthApi.getOverview();
      setItems(res.data?.items || res.data || []);
    } catch {
      message.error('加载供应商健康度数据失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // 10 秒自动刷新
  useEffect(() => {
    const timer = setInterval(() => {
      void fetchData();
    }, 10000);
    return () => clearInterval(timer);
  }, [fetchData]);

  return (
    <div>
      <PageHeader
        title="供应商健康度"
        prefix={<HeartOutlined style={{ color: '#eb2f96', fontSize: 20 }} />}
        extra={(
          <Button icon={<ReloadOutlined />} onClick={() => void fetchData()} loading={loading}>
            刷新
          </Button>
        )}
      />
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
              title: 'Provider',
              dataIndex: 'provider',
              width: 160,
              render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
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
              render: (val: number) =>
                val != null ? `${(val * 100).toFixed(1)}%` : '—',
            },
            {
              title: '错误率',
              dataIndex: 'errorRate',
              width: 100,
              render: (val: number) =>
                val != null ? `${(val * 100).toFixed(1)}%` : '—',
            },
            {
              title: '平均延迟',
              dataIndex: 'avgLatencyMs',
              width: 110,
              render: (val: number) =>
                val != null ? `${val.toFixed(0)} ms` : '—',
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
          ]}
        />
      )}
    </Card>
    </div>
  );
}
