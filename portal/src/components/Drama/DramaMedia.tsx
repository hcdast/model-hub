import { useEffect, useState } from 'react';
import { Button, Alert, Spin } from 'antd';
import { dramaApi, type DramaCandidate } from '../../services/drama-api';

/** Direct media first; authenticated owned-media endpoint when a CDN cannot play inline. */
export default function DramaMedia({ projectId, candidate, audio = false }: { projectId: string; candidate: DramaCandidate; audio?: boolean }) {
  const [fallback, setFallback] = useState(false), [blob, setBlob] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => { setFallback(false); setBlob(''); setError(''); }, [candidate.id, candidate.url]);
  useEffect(() => {
    if (!fallback) return;
    let disposed = false, objectUrl = '';
    setError('');
    void dramaApi.media(projectId, candidate.id).then(data => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(data); setBlob(objectUrl);
    }).catch(() => { if (!disposed) setError('媒体暂时无法加载。已有素材保留，可重试或下载原文件。'); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fallback, projectId, candidate.id, attempt]);
  const failed = () => { if (!fallback) setFallback(true); else if (blob) setError('当前浏览器无法播放此编码，请下载后播放。'); };
  return <div className="sd-media" aria-label={audio ? '音频预览' : '视频预览'}>
    {fallback && !blob && !error ? <Spin tip="正在读取素材…" /> : audio ? <audio controls preload="metadata" src={blob || candidate.url} onError={failed} /> : <video controls playsInline preload="metadata" src={blob || candidate.url} onError={failed} />}
    {error && <Alert role="alert" type="warning" message={error} action={<Button onClick={() => { setBlob(''); setError(''); setFallback(true); setAttempt(n => n + 1); }}>重试</Button>} />}
    {blob && <a href={blob} download={`${candidate.kind}-${candidate.id}.${audio ? 'mp3' : 'mp4'}`}>下载{audio ? '音频' : '视频'}文件</a>}
  </div>;
}
