import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Select, Space, Spin } from 'antd';
import { dramaApi, type DramaVoice } from '../../services/drama-api';
import { getApiErrorMessage } from '../../store/auth-store';

const isChinese = (v: DramaVoice) => [v.language, v.locale].some(v => /^(zh|cmn)(-|_|$)/i.test(v || '')) || /chinese|mandarin|中文|普通话|汉语/i.test([v.name, v.language, v.locale].join(' '));
export default function DramaVoicePicker({ configId, value, onChange }: { configId: string; value?: string; onChange: (value: string) => void }) {
  const [items, setItems] = useState<DramaVoice[]>([]), [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState(''), [chineseOnly, setChineseOnly] = useState(false);
  const [selected, setSelected] = useState<DramaVoice>();
  const epoch = useRef(0), page = useRef(1), loading = useRef(false), continueAll = useRef(false);
  const load = async (all = false) => {
    if (loading.current || page.current > 100) return;
    loading.current = true; continueAll.current = all; setBusy(true); setError('');
    const version = epoch.current;
    try {
      do {
        const result = await dramaApi.voices(configId, page.current);
        if (version !== epoch.current) return;
        setItems(prev => [...new Map([...prev, ...result.items].map(v => [v.id, v])).values()]);
        page.current++; setMore(result.hasMore);
        if (!result.hasMore || page.current > 100 || !continueAll.current) break;
      } while (true);
    } catch (e) { if (version === epoch.current) setError(getApiErrorMessage(e, '音色加载失败，已加载的音色仍可使用，请重试')); }
    finally { if (version === epoch.current) { loading.current = false; continueAll.current = false; setBusy(false); } }
  };
  useEffect(() => {
    epoch.current++; page.current = 1; loading.current = false; continueAll.current = false; setItems([]); setSelected(undefined); setMore(true); setQuery('');
    void load();
    return () => { epoch.current++; continueAll.current = false; };
  }, [configId]);
  useEffect(() => { const voice = items.find(v => v.id === value); setSelected(prev => voice || (prev?.id === value ? prev : undefined)); }, [items, value]);
  const matching = items.filter(v => (!chineseOnly || isChinese(v)) && [v.name, v.language, v.locale].join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => Number(isChinese(b)) - Number(isChinese(a)) || a.name.localeCompare(b.name, 'zh-CN'));
  const saved = value && !matching.some(v => v.id === value) ? [{ value, label: selected?.id === value ? selected.name + ' · 当前已选' : '已保存音色（生成前将重新校验）' }] : [];
  return <section aria-label="选择旁白音色"><label>1. 选择并试听音色</label><p>中文标注音色优先展示。试听官方示例不创建任务；实际配音语言在下方设置，多语言音色也可以用于中文。</p>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Input aria-label="搜索官方音色" allowClear placeholder="搜索音色名称或语言" value={query} onChange={e => setQuery(e.target.value)} />
      <Checkbox checked={chineseOnly} onChange={e => setChineseOnly(e.target.checked)}>仅看中文标注音色</Checkbox>
      <Select aria-label="旁白音色" style={{ width: '100%' }} placeholder="选择声音后可试听官方样音" value={value} onChange={onChange} options={[...saved, ...matching.map(v => ({ value: v.id, label: v.name + ' · ' + (v.language || v.locale || '多语言') }))]} notFoundContent={busy ? <Spin size="small" /> : '已加载的音色中没有匹配项，可继续加载或调整筛选'} />
    </Space>
    {selected?.id === value && selected?.preview && <audio key={selected.id} aria-label={selected.name + '示例试听'} controls preload="none" src={selected.preview} style={{ width: '100%', marginTop: 12 }} />}
    <p aria-live="polite">已加载 {items.length} 个兼容音色，匹配 {matching.length} 个。{more ? '搜索范围为已加载音色，加载全部后可完整搜索。' : '已加载全部官方兼容音色。'}</p>
    {error && <Alert type="warning" message={error} action={<Button disabled={busy} onClick={() => void load()}>重试加载</Button>} />}
    <Space wrap>{busy ? <><Spin size="small" /><span>正在加载音色…</span><Button onClick={() => { continueAll.current = false; }}>停止继续加载</Button></> : more && <><Button onClick={() => void load()}>加载更多音色</Button><Button disabled={page.current > 100} onClick={() => void load(true)}>加载全部音色以搜索</Button></>}</Space>
    {page.current > 100 && more && <p>本次已达 100 页加载上限，可调整关键词筛选已加载音色。</p>}
  </section>;
}
