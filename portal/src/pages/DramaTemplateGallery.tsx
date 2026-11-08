import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Pagination, Select, Skeleton, Tag } from 'antd';
import TemplateActivity from '../components/Templates/TemplateActivity';
import { Link, useSearchParams } from 'react-router-dom';
import { CopyOutlined, PlaySquareOutlined, SearchOutlined } from '@ant-design/icons';
import { dramaTemplateCatalogApi, DramaTemplateSummary } from '../services/drama-template-api';
import { useDramaTemplateCopy } from '../hooks/useDramaTemplateCopy';
import { useI18n } from '../i18n';
import './Templates.css';

export default function DramaTemplateGallery() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') || '';
  const order = params.get('order') === 'newest' ? 'newest' : 'recommended';
  const source = ['official', 'community'].includes(params.get('source') || '') ? params.get('source')! : '';
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(params.get('page'))) || 1));
  const [data, setData] = useState<{ items: DramaTemplateSummary[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const { copyTemplate, copyingId, loginPrompt } = useDramaTemplateCopy();
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); next.set('type', 'short-drama'); value ? next.set(key, value) : next.delete(key); if (key !== 'page') next.delete('page'); setParams(next, { replace: key === 'search' }); };
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(false);
    const timer = setTimeout(() => { void dramaTemplateCatalogApi.list(search, page, controller.signal, order, source).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) { setError(true); setData(null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, search ? 250 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, page, order, source, retry]);
  return <div className="templates-page">
    {loginPrompt}
    <header className="templates-heading"><div><p className="templates-eyebrow">{t('SHORT DRAMA TEMPLATES')}</p><h1>{t('Find a story. Make it yours.')}</h1><p>{t('Preview a story structure, then make it your own.')}</p></div><Link to="/works"><Button>{t('My works')}</Button></Link></header>
    <Alert className="creation-template-notice" type="info" showIcon message={t('Story structures, ready to edit')} description={t('Templates include story, characters and shots, without generated media. Creating a draft does not start paid generation.')} />
    <div className="templates-search-row"><Input prefix={<SearchOutlined />} allowClear maxLength={100} size="large" aria-label={t('Search short drama templates')} placeholder={t('Search short drama templates')} value={search} onChange={e => update('search', e.target.value)} />
      <Select aria-label={t('Template source')} value={source} onChange={value => update('source', value)} options={[['', 'All templates'], ['official', 'Official'], ['community', 'Community']].map(([value, label]) => ({ value, label: t(label) }))} />
      <Select aria-label={t('Sort templates')} value={order} onChange={value => update('order', value)} options={ [['recommended', 'Recommended'], ['newest', 'Newest']].map(([value, label]) => ({ value, label: t(label) }))} /></div>
    {order === 'recommended' && <p className="templates-recommendation-note">{t('Recommendations use distinct creators and successful projects. New templates follow creation time. Data refreshes within a minute.')}</p>}
    <div className="templates-results-heading"><h2>{t('Short drama templates')} <span>{loading || error ? '—' : data?.total || 0}</span></h2></div>
    {error ? <Alert type="error" message={t('Unable to load templates. Please try again.')} action={<Button onClick={() => setRetry(v => v + 1)}>{t('Retry')}</Button>} />
      : loading ? <Skeleton active /> : !data?.items.length ? <div className="templates-empty"><Empty description={t('No matching templates. Try another search or start a new project.')} /><Button onClick={() => { const next = new URLSearchParams({ type: 'short-drama' }); setParams(next); }}>{t('Clear filters')}</Button><Link to="/create"><Button>{t('Start creating')}</Button></Link></div>
      : <div className="templates-grid">{data.items.map(item => <article className="template-card" key={item.id}>
        <Link className="template-card-visual" to={`/drama-templates/${encodeURIComponent(item.id)}`} state={{ discovery: `/discover?${params}` }}><div className="template-cover creation-template-cover"><PlaySquareOutlined /><span>{item.shotCount} {t('shots')} · {item.ratio}</span></div><Tag className="template-category">{t('Short drama project')}</Tag></Link>
        <div className="template-card-body"><div className="template-attribution"><span className="template-source">{t(item.source === 'community' ? 'Community' : 'Official')}</span><span>v{item.version}</span></div><h3><Link to={`/drama-templates/${encodeURIComponent(item.id)}`} state={{ discovery: `/discover?${params}` }}>{item.name}</Link></h3><p className="template-description">{item.description}</p><TemplateActivity metrics={item.metrics} drama /><div className="template-card-actions"><Link to={`/drama-templates/${encodeURIComponent(item.id)}`} state={{ discovery: `/discover?${params}` }}>{t('View details')}</Link><Button type="primary" icon={<CopyOutlined />} loading={copyingId === item.id} disabled={!!copyingId && copyingId !== item.id} onClick={() => void copyTemplate(item.id)}>{t('Create short drama')}</Button></div></div>
      </article>)}</div>}
    {!!data && data.total > 12 && <Pagination current={page} total={data.total} pageSize={12} showSizeChanger={false} onChange={value => update('page', String(value))} />}
  </div>;
}
