import { useEffect, useState } from 'react';
import { Alert, Button, Space, Spin } from 'antd';
import type { DramaPlan } from '../../services/drama-api';
import { voiceOverflows, type DramaTimingReport } from '../../../../src/short-drama/drama-timing';

export default function DramaTimingCheck({ plan, report, busy, error, check, locate, fit }: {
  plan: DramaPlan; report?: DramaTimingReport; busy: boolean; error: string;
  check: () => void; locate: (index: number) => void; fit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (report?.voices.some(v => v.error || voiceOverflows(plan.shots.find(s => s.id === v.shotId)?.duration || 0, v.seconds))) setExpanded(true); }, [report, plan.shots]);
  const invalid = report?.voices.filter(v => v.error || voiceOverflows(plan.shots.find(s => s.id === v.shotId)?.duration || 0, v.seconds)) || [];
  return <section className="sd-timing-check" aria-label="旁白时长检查">
    <Space wrap><strong>旁白时长检查</strong><Button size="small" loading={busy} onClick={check}>{report ? '重新检查' : '检查旁白时长'}</Button>{report && <Button type="text" size="small" onClick={() => setExpanded(v => !v)}>{expanded ? '收起详情' : '查看详情'}</Button>}</Space>
    <p>读取已选音频，不调用生成模型、不扣积分。字幕按镜头内的显示范围呈现，可手动校正。</p>
    {busy && <Spin tip="正在读取已选旁白…"><div style={{ minHeight: 30 }} /></Spin>}
    {error && <Alert type="warning" message={error} />}
    {!busy && report && <Alert type={invalid.length ? 'warning' : 'success'} message={invalid.length ? `${invalid.length} 个镜头的旁白需要处理` : report.voices.length ? '已选旁白均能完整放入镜头' : '尚未选用旁白，本次按静音镜头合成'} />}
    {invalid.some(v => !v.error) && <Button style={{ marginTop: 12 }} onClick={fit}>延长超长镜头以容纳旁白</Button>}
    {expanded && report && <div className="sd-timing-list">{report.voices.map(v => {
      const index = plan.shots.findIndex(s => s.id === v.shotId), shot = plan.shots[index];
      if (!shot) return null;
      return <div key={v.shotId}><strong>镜头 {index + 1} · {shot.title}</strong><span>{v.error || `旁白 ${v.seconds!.toFixed(1)} 秒 / 镜头 ${shot.duration} 秒`}</span><Button size="small" onClick={() => locate(index)}>去调整此镜头</Button></div>;
    })}</div>}
  </section>;
}
