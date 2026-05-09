import { useEffect, useState } from 'react';
import { Card, Descriptions, Typography, Space, Button, Alert } from 'antd';
import { ReloadOutlined, LinkOutlined } from '@ant-design/icons';
import { systemInfoApi } from '../services/api';
import PageHeader from '../components/PageHeader';

export default function SystemInfoPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res: any = await systemInfoApi.get();
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const ops = data?.opsLinks || {};

  return (
    <div>
      <PageHeader
        title="系统信息"
        subtitle="只读运行态，不含密钥。运维外链由环境变量 OPS_PROMETHEUS_URL / OPS_GRAFANA_URL / OPS_DOCUMENTATION_URL 注入。"
        extra={<Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>}
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="健康检查"
        description="对外存活/就绪探针仍为 GET /health/liveness 与 /health/readiness（无需管理端权限）。"
      />
      <Card loading={loading}>
        {data && (
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 2 }}>
            <Descriptions.Item label="应用版本">{data.appVersion}</Descriptions.Item>
            <Descriptions.Item label="进程类型">{data.processType}</Descriptions.Item>
            <Descriptions.Item label="Node">{data.nodeVersion}</Descriptions.Item>
            <Descriptions.Item label="运行时长">{`${Math.floor((data.uptimeSec || 0) / 3600)}h ${Math.floor(((data.uptimeSec || 0) % 3600) / 60)}m`}</Descriptions.Item>
            <Descriptions.Item label="MongoDB">
              {data.mongodb?.connected ? '已连接' : '未连接'}
            </Descriptions.Item>
            <Descriptions.Item label="生成时间">{data.generatedAt}</Descriptions.Item>
          </Descriptions>
        )}
        <Typography.Title level={5} style={{ marginTop: 24 }}>运维链接</Typography.Title>
        <Space direction="vertical" style={{ width: '100%' }}>
          {ops.prometheus && (
            <a href={ops.prometheus} target="_blank" rel="noreferrer">
              <LinkOutlined /> Prometheus
            </a>
          )}
          {ops.grafana && (
            <a href={ops.grafana} target="_blank" rel="noreferrer">
              <LinkOutlined /> Grafana
            </a>
          )}
          {ops.documentation && (
            <a href={ops.documentation} target="_blank" rel="noreferrer">
              <LinkOutlined /> 文档
            </a>
          )}
          {!ops.prometheus && !ops.grafana && !ops.documentation && (
            <Typography.Text type="secondary">未配置运维外链，请在部署环境设置 OPS_* 变量。</Typography.Text>
          )}
        </Space>
      </Card>
    </div>
  );
}
