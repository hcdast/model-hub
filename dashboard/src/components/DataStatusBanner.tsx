import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Alert, Button } from 'antd';
import { clearRequestFailures, useRequestStatus } from '../services/request-status';
export default function DataStatusBanner() {
  const { failures } = useRequestStatus(); const location = useLocation();
  useEffect(() => clearRequestFailures(), [location.pathname]);
  const rows = Object.values(failures); if (!rows.length) return null;
  const success = rows.map(r => r.lastSuccess).filter(Boolean).sort()[0];
  return <Alert showIcon type="error" style={{ marginBottom: 16 }} message="部分数据加载失败，当前内容可能过期或不完整" description={`${rows[0].message}。${success ? `上次成功：${new Date(success).toLocaleString()}` : '尚未成功加载。'}`} action={<Button size="small" onClick={() => window.location.reload()}>重新加载</Button>} />;
}
