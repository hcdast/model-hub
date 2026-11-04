import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Space, Upload, message } from 'antd';
import type { ParamDocItem } from '../../types/model-params';
import portalApi from '../../services/auth-api';

function httpUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export default function MediaParamField({ param, value, onChange }: { param: ParamDocItem; value: unknown; onChange: (value: unknown) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const values = param.type === 'array' ? Array.isArray(value) ? value.map(String) : [] : typeof value === 'string' && value ? [value] : [];
  const limit = param.type === 'array' ? param.maxItems ?? 100 : 1;
  const emit = (next: string[]) => onChange(param.type === 'array' ? next : next[0]);
  const accept = param.media?.accept || [`${param.media?.kind || 'image'}/*`];
  const maxBytes = Math.min(param.media?.maxBytes ?? 20 * 1024 * 1024, 20 * 1024 * 1024);
  const upload = async (file: File) => {
    if (busy) return;
    if (values.length >= limit) { setError('已达到素材数量上限'); return; }
    if (file.size > maxBytes || !accept.some(type => type.endsWith('/*') ? file.type.startsWith(type.slice(0, -1)) : file.type === type)) { setError('文件类型或大小不符合限制'); return; }
    setBusy(true); setError('');
    try {
      const body = new FormData(); body.append('file', file);
      const res = await portalApi.post<unknown, { code: number; data: { url: string }; message?: string }>('/workflow-assets', body);
      if (res.code !== 0 || !httpUrl(res.data?.url || '')) throw new Error(res.message || '上传失败');
      if (alive.current) emit([...values, res.data.url]);
    } catch (err) { if (alive.current) { setError('上传失败，请确认已登录且素材存储已配置'); message.error('上传失败'); } }
    finally { if (alive.current) setBusy(false); }
  };
  return <Space direction="vertical" style={{ width: '100%' }}>
    {values.map((url, i) => <div key={i} style={{ border: '1px solid #7774', borderRadius: 8, padding: 8 }}>
      {param.media?.referencePrefix && <code>@{param.media.referencePrefix}{i + 1}</code>}
      <Input aria-label={`${param.name} URL ${i + 1}`} disabled={busy} value={url} placeholder="https://…" onChange={e => emit(values.map((v, at) => at === i ? e.target.value : v))} />
      {httpUrl(url) && (param.media?.kind === 'image' ? <img src={url} alt={`${param.label || param.name} ${i + 1}`} style={{ maxWidth: '100%', maxHeight: 160 }} /> : param.media?.kind === 'video' ? <video src={url} controls preload="metadata" style={{ maxWidth: '100%', maxHeight: 180 }} /> : <audio src={url} controls preload="metadata" />)}
      <Space><Button disabled={busy} onClick={() => emit(values.filter((_, at) => at !== i))}>移除</Button>
        <Button disabled={busy || i === 0} onClick={() => { const next = [...values]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; emit(next); }}>上移</Button>
        <Button disabled={busy || i === values.length - 1} onClick={() => { const next = [...values]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; emit(next); }}>下移</Button></Space>
    </div>)}
    <Button disabled={busy || values.length >= limit} onClick={() => emit([...values, ''])}>添加 URL</Button>
    <Upload.Dragger accept={accept.join(',')} disabled={busy || values.length >= limit} showUploadList={false} beforeUpload={file => { void upload(file); return false; }}>
      <p>{busy ? '正在上传…' : '点击或拖入文件上传（需要登录）'}</p><p>{accept.join(', ')} · 最大 {Math.round(maxBytes / 1024 / 1024)} MiB</p>
    </Upload.Dragger>
    {error && <Alert type="error" message={error} />}
  </Space>;
}
