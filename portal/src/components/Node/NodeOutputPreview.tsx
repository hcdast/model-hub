import { useState } from 'react';

function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch { return undefined; }
}

function Media({ kind, url }: { kind: 'image' | 'video' | 'audio'; url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div role="alert">{kind} 资源无法加载，地址可能已过期或不可访问。</div>;
  if (kind === 'image') return <img alt="节点生成图片" src={url} onError={() => setFailed(true)} style={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain' }} />;
  if (kind === 'video') return <video className="nodrag nowheel" controls preload="metadata" src={url} onError={() => setFailed(true)} style={{ width: '100%', maxHeight: 400 }} />;
  return <audio className="nodrag nowheel" controls preload="metadata" src={url} onError={() => setFailed(true)} style={{ width: '100%' }} />;
}

/** 只消费执行器的明确输出别名，不猜测供应商对象或执行 HTML。 */
export default function NodeOutputPreview({ output }: { output: unknown }) {
  if (output === undefined || output === null) return <div>暂无运行输出</div>;
  const record = typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : {};
  const text = typeof output === 'string' ? output : typeof record.text === 'string' ? record.text : undefined;
  let raw: string;
  try { raw = JSON.stringify(output, null, 2) ?? String(output); } catch { raw = '结果无法序列化'; }
  return <div className="nodrag nowheel" style={{ width: '100%', overflowWrap: 'anywhere' }}>
    {text !== undefined && <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>}
    {(['image', 'video', 'audio'] as const).map((kind) => {
      const values = Array.isArray(record[kind]) ? record[kind] as unknown[] : [record[kind]];
      return values.map((value, index) => {
        const url = mediaUrl(value);
        return url ? <Media key={`${kind}:${url}:${index}`} kind={kind} url={url} /> : value !== undefined ? <div key={`${kind}:${index}`} role="alert">{kind} 地址无效或协议不受支持</div> : null;
      });
    })}
    <details><summary>原始 JSON</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', fontSize: 12 }}>{raw}</pre></details>
  </div>;
}
