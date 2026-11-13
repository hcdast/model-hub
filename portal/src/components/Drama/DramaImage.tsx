import { useEffect, useState, type CSSProperties } from 'react';
import { Button } from 'antd';
import { dramaApi, type DramaCandidate } from '../../services/drama-api';

interface Props {
  projectId: string;
  candidate: DramaCandidate;
  alt: string;
  className?: string;
  style?: CSSProperties;
  retryable?: boolean;
  onDimensions?: (size: { width: number; height: number }) => void;
}

/** Reset the preview, including its object URL, when the candidate or archived URL changes. */
export default function DramaImage(props: Props) {
  return <ImageSource key={JSON.stringify([props.projectId, props.candidate.id, props.candidate.url])} {...props} />;
}

function ImageSource({ projectId, candidate, alt, className, style, retryable = true, onDimensions }: Props) {
  // Keep HTTP source URLs intact. Secure pages read them server-side so the browser
  // never upgrades the CDN request to HTTPS before an image error can be handled.
  const [fallback, setFallback] = useState(() => window.location.protocol === 'https:' && /^http:\/\//i.test(candidate.url || ''));
  const [blob, setBlob] = useState('');
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!fallback) return;
    let disposed = false, objectUrl = '';
    void dramaApi.media(projectId, candidate.id).then(data => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(data);
      setBlob(objectUrl);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fallback, projectId, candidate.id, attempt]);

  if (error || (fallback && !blob)) return <span className={`${className || ''} sd-image-placeholder`} style={style} role={error ? 'alert' : 'status'}>
    <span>{error ? '图片暂时无法加载，结果已保留' : '正在读取图片…'}</span>
    {error && retryable && <Button size="small" onClick={() => { setBlob(''); setError(false); setAttempt(n => n + 1); }}>重试读取图片</Button>}
  </span>;
  return <img className={className} style={style} src={blob || candidate.url} alt={alt}
    onLoad={e => onDimensions?.({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
    onError={() => { if (fallback) setError(true); else setFallback(true); }} />;
}
