import { useEffect, useState } from 'react';
import { Alert, Button, Select, Space, Spin } from 'antd';
import { dramaApi, type DramaVoice } from '../../services/drama-api';
import { getApiErrorMessage } from '../../store/auth-store';

export default function DramaVoicePicker({ configId, value, onChange }: { configId: string; value?: string; onChange: (value: string) => void }) {
  const [items, setItems] = useState<DramaVoice[]>([]), [page, setPage] = useState(1), [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setBusy(true); setError('');
    dramaApi.voices(configId, page).then(result => { if (active) { setItems(result.items); setMore(result.hasMore); } }).catch(e => { if (active) { setItems([]); setMore(false); setError(getApiErrorMessage(e, '音色加载失败，请重试')); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [configId, page, retry]);
  const [selected, setSelected] = useState<DramaVoice>();
  useEffect(() => { const voice = items.find(v => v.id === value); setSelected(prev => voice || (prev?.id === value ? prev : undefined)); }, [items, value]);
  return <section aria-label="选择旁白音色"><label>1. 选择并试听音色</label><p>试听官方示例不创建生成任务。选好声音后，可调整语速，再查看本次积分。</p>
    {error && <Alert type="warning" message={error} action={<Button onClick={() => setRetry(v => v + 1)}>重试</Button>} />}
    {busy ? <Spin aria-label="加载音色" /> : <Select aria-label="旁白音色" style={{ width: '100%' }} showSearch optionFilterProp="label" placeholder="搜索本页音色名称或语言" value={value} onChange={onChange} options={[...(value && !items.some(v => v.id === value) ? [{ value, label: selected?.id === value ? selected.name : '已保存音色（生成前将重新校验）' }] : []), ...items.map(v => ({ value: v.id, label: `${v.name} · ${v.language || v.locale || '多语言'}` }))]} />}
    {selected && selected.id === value && selected.preview && <audio key={selected.id} aria-label={`${selected.name}示例试听`} controls preload="none" src={selected.preview} style={{ width: '100%', marginTop: 12 }} />}
    {!busy && !error && !items.length && <p>本页没有兼容的 Multilingual 3 音色，可继续翻页查看。</p>}
    <Space style={{ marginTop: 12 }}><Button disabled={busy || page <= 1} onClick={() => setPage(v => v - 1)}>上一页音色</Button><span>第 {page} 页</span><Button disabled={busy || !more} onClick={() => setPage(v => v + 1)}>下一页音色</Button></Space>
  </section>;
}
