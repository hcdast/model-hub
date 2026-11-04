import { useEffect, useState } from 'react';
import { ApartmentOutlined, PictureOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n';
import { templateMediaUrl } from '../../services/template-api';

export function TemplateCover({ url, name, nodeCount }: { url?: string; name: string; nodeCount: number }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const src = templateMediaUrl(url);
  return <div className="template-cover">
    {src && !failed ? <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} />
      : <div className="template-cover-fallback"><div className="template-mini-flow" aria-hidden="true"><span /><i /><span><ApartmentOutlined /></span><i /><span /></div>
        <span>{nodeCount} {t('nodes')} · {t('Workflow template')}</span></div>}
  </div>;
}
export function TemplateMedia({ url, type, label }: { url: string; type: 'image' | 'video' | 'audio'; label: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const src = templateMediaUrl(url);
  if (!src || failed) return <div className="template-media-unavailable"><PictureOutlined />{t('Preview unavailable')}</div>;
  if (type === 'video') return <video src={src} controls playsInline preload="metadata" aria-label={label} onError={() => setFailed(true)} />;
  if (type === 'audio') return <div className="template-audio"><audio src={src} controls preload="metadata" aria-label={label} onError={() => setFailed(true)} /></div>;
  return <img src={src} alt={label} loading="lazy" onError={() => setFailed(true)} />;
}
