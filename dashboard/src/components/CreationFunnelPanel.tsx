import { useEffect, useState } from 'react';
import { Alert, Card, Space, Statistic } from 'antd';
import api from '../services/api';
interface Funnel { from: string; to: string; counts: Record<string, number> }
export default function CreationFunnelPanel({ kind, revision }: { kind: 'workflow' | 'short-drama'; revision: number }) {
  const [data, setData] = useState<Funnel>(), [error, setError] = useState(false);
  useEffect(() => { let active = true; setData(undefined); setError(false);
    void api.get<never, { data: Funnel }>('/creation-templates/funnel', { params: { kind } }).then(r => { if (!r.data?.counts || !r.data.from || !r.data.to) throw new Error('Invalid funnel response'); if (active) setData(r.data); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [kind, revision]);
  const count = (name: string) => data ? data.counts[name] || 0 : '—';
  return <Card size="small" title="近 30 天操作漏斗" style={{ marginTop: 20 }}>
    <p>浏览和采用点击按匿名会话去重；报价查看、选片点击、下载开始按作品去重，涵盖全部短剧作品。各阶段不强行关联为同一批用户，不能据此计算完整转化率。下载开始不表示下载完成，选片点击不表示已保存。</p>
    {error && <Alert type="warning" message="操作统计暂时不可用" />}
    <Space wrap size={24}><Statistic title="模板详情浏览会话" value={count('template_view')} /><Statistic title="采用点击会话" value={count('create_click')} />{kind === 'short-drama' && <><Statistic title="查看报价作品" value={count('quote_viewed')} /><Statistic title="选片点击作品" value={count('take_selected')} /><Statistic title="下载开始作品" value={count('download_started')} /></>}</Space>
    {data && <p>{new Date(data.from).toLocaleString()} — {new Date(data.to).toLocaleString()}；事件保留 90 天，从本功能启用后开始累计。</p>}
  </Card>;
}
