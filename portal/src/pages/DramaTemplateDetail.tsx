import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Alert, Button, Result, Skeleton, Tag } from 'antd';
import { isAxiosError } from 'axios';
import { dramaTemplateCatalogApi, DramaTemplateDetail as Detail } from '../services/drama-template-api';
import { useDramaTemplateCopy } from '../hooks/useDramaTemplateCopy';
import { useI18n } from '../i18n';
import './Templates.css';
import './Creation.css';
import { templateEvent } from '../services/creation-events';

export default function DramaTemplateDetail() {
  const { id = '' } = useParams(), location = useLocation(), { t } = useI18n();
  const discovery = location.state?.discovery;
  const back = typeof discovery === 'string' && /^\/discover(?:\?|$)/.test(discovery) ? discovery : '/discover?type=short-drama';
  const [template, setTemplate] = useState<Detail | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState<'missing' | 'failed' | null>(null), [retry, setRetry] = useState(0);
  const { copyTemplate, copyingId, loginPrompt } = useDramaTemplateCopy();
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null); setTemplate(null);
    void dramaTemplateCatalogApi.detail(id, controller.signal).then(value => { if (!controller.signal.aborted) setTemplate(value); })
      .catch(e => { if (!controller.signal.aborted) setError(isAxiosError(e) && e.response?.status === 404 ? 'missing' : 'failed'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);
  useEffect(() => { if (template) templateEvent('template_view', 'short-drama', template.id); }, [template]);
  if (loading) return <div className="templates-page"><Skeleton active /></div>;
  if (error === 'missing') return <Result status="404" title={t('Template unavailable')} extra={<Link to={back}>{t('Back to discovery')}</Link>} />;
  if (error || !template) return <div className="templates-page"><Alert type="error" message={t('Unable to load templates. Please try again.')} action={<Button onClick={() => setRetry(v => v + 1)}>{t('Retry')}</Button>} /></div>;
  const useButton = <Button type="primary" size="large" loading={!!copyingId} onClick={() => void copyTemplate(id)}>{t('Use template to create project')}</Button>;
  return <div className="templates-page">
    {loginPrompt}<Link className="template-back" to={back}>{t('Back to discovery')}</Link>
    <header className="creation-heading"><div><Tag>{t('Short drama project')}</Tag><Tag>v{template.version}</Tag><h1>{template.name}</h1><p>{template.description}</p></div>{useButton}</header>
    <Alert className="creation-template-notice" type="info" showIcon message={t('Templates include story, characters and shots, without generated media. Creating a draft does not start paid generation.')} />
    <section className="template-section"><h2>{t('Story preview')}</h2><p>{template.story}</p></section>
    <section className="template-section"><h2>{t('Characters')}</h2>{template.characters.map((c, i) => <div key={i}><h3>{c.name}</h3><p>{c.description}</p></div>)}</section>
    <section className="template-section"><h2>{t('Storyboard preview')}</h2>{template.shots.map((s, i) => <article className="template-example" key={i}><h3>{s.title} · {s.duration} {t('seconds')}</h3><p>{s.description}</p></article>)}</section>
    <section className="template-section"><h2>{t('How to use')}</h2><p className="template-instructions">{template.instructions || t('Create your own draft, review the story and cast, then generate and export in five guided steps.')}</p>{useButton}</section>
  </div>;
}
