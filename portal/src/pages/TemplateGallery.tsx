import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Empty, Input, Pagination, Select, Skeleton, Tag } from 'antd';
import { ArrowRightOutlined, CopyOutlined, SearchOutlined, ApartmentOutlined, CompassOutlined } from '@ant-design/icons';
import { useI18n } from '../i18n';
import { useTemplateCopy } from '../hooks/useTemplateCopy';
import { TemplateCover } from '../components/Templates/TemplateMedia';
import { TemplatePage, templateCatalogApi, templateDate, templateScenarios } from '../services/template-api';
import './Templates.css';

const pageSize = 12;
export default function TemplateGallery() {
  const { t, locale } = useI18n();
  const [search, setSearch] = useSearchParams();
  const query = search.get('search') || '';
  const source = ['official', 'community'].includes(search.get('source') || '') ? search.get('source')! : '';
  const scenario = templateScenarios.some(([key]) => key === search.get('scenario')) ? search.get('scenario')! : '';
  const category = search.get('category') || '';
  const order = ['updated', 'newest', 'name'].includes(search.get('order') || '') ? search.get('order')! : 'updated';
  const page = Math.min(100000, Math.max(1, Math.trunc(Number(search.get('page'))) || 1));
  const [data, setData] = useState<TemplatePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [sourceCounts, setSourceCounts] = useState<{ official: number; community: number } | null>(null);
  const { copyTemplate, copyingId, loginPrompt } = useTemplateCopy();
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearch(next, { replace: key === 'search' });
  };
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(['official', 'community'].map(source => templateCatalogApi.list({ source, pageSize: 1 }, controller.signal)))
      .then(([official, community]) => { if (!controller.signal.aborted) setSourceCounts({ official: official.total, community: community.total }); })
      .catch(() => { if (!controller.signal.aborted) setSourceCounts(null); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    const timer = setTimeout(() => {
      templateCatalogApi.list({ search: query, source, scenario, category, order, page, pageSize }, controller.signal)
        .then(result => { if (!controller.signal.aborted) setData(result); })
        .catch(() => { if (!controller.signal.aborted) { setError(true); setData(null); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, source, scenario, category, order, page, revision]);
  const filtered = !!(query || source || scenario || category);
  const pageOutOfRange = !!data?.total && !data.items.length;
  const communityEmpty = source === 'community' && sourceCounts?.community === 0;
  const detailState = { discovery: `/discover${search.size ? `?${search}` : ''}` };

  return <div className="templates-page">
    {loginPrompt}
    <header className="templates-heading">
      <div><p className="templates-eyebrow"><CompassOutlined /> {t('WORKFLOW DISCOVERY')}</p>
        <h1>{t('Find a workflow. Make it yours.')}</h1>
        <p>{t('Explore ready-made workflows, see how they work, and start creating with your own inputs.')}</p></div>
      <Link to="/workflows"><Button icon={<ApartmentOutlined />}>{t('My workflows')}</Button></Link>
    </header>
    <Alert style={{ marginBottom: 24 }} type="info" showIcon message={t('Make your first AI short drama')} description={t('Start with a story and follow five guided steps to create your film.')} action={<Link to="/short-dramas"><Button type="primary">{t('Open short drama studio')}</Button></Link>} />
    <div className="templates-journey" aria-label={t('How to use a template')}>
      {['Find your use case', 'Preview the workflow', 'Copy, customize & run'].map((label, index) => <span key={label}><b>{index + 1}</b>{t(label)}{index < 2 && <ArrowRightOutlined />}</span>)}
    </div>
    <section className="templates-discovery" aria-label={t('Discover workflows')}>
      <div className="templates-source-tabs" role="group" aria-label={t('Template source')}>
        {[['', 'All workflows'], ['official', 'Official templates'], ['community', 'Community templates']].map(([key, label]) =>
          <button key={key} type="button" aria-pressed={source === key} className={source === key ? 'active' : ''} onClick={() => update('source', key)}>{t(label)}{sourceCounts && <span className="template-source-count">{key === 'official' ? sourceCounts.official : key === 'community' ? sourceCounts.community : sourceCounts.official + sourceCounts.community}</span>}</button>)}
      </div>
      <div className="templates-search-row">
        <Input allowClear maxLength={100} size="large" prefix={<SearchOutlined />} value={query} onChange={event => update('search', event.target.value)}
          placeholder={t('Search by task, model or keyword...')} aria-label={t('Search templates')} />
        <Select value={category} onChange={value => update('category', value)} aria-label={t('Output category')} options={[
          ['', 'All types'], ['Image', 'Image'], ['Video', 'Video'], ['Audio', 'Audio'], ['Text', 'Text'], ['Creative', 'Creative'],
        ].map(([value, label]) => ({ value, label: t(label) }))} />
        <Select value={order} onChange={value => update('order', value)} aria-label={t('Sort templates')} options={[
          ['updated', 'Recently updated'], ['newest', 'Newest'], ['name', 'Name A–Z'],
        ].map(([value, label]) => ({ value, label: t(label) }))} />
      </div>
      <div className="templates-scenarios" role="group" aria-label={t('Explore by use case')}>
        <button type="button" className={!scenario ? 'active' : ''} aria-pressed={!scenario} onClick={() => update('scenario', '')}>{t('All use cases')}</button>
        {templateScenarios.map(([key, label]) => <button key={key} type="button" className={scenario === key ? 'active' : ''} aria-pressed={scenario === key} onClick={() => update('scenario', key)}>{t(label)}</button>)}
      </div>
    </section>
    <div className="templates-results-heading" aria-live="polite"><h2>{t('Explore workflows')} <span>{loading || error ? '—' : data?.total || 0}</span></h2>
      {filtered && <Button type="text" onClick={() => setSearch({})}>{t('Clear filters')}</Button>}</div>
    {error ? <Alert type="error" showIcon message={t('Unable to load templates. Please try again.')} action={<Button onClick={() => setRevision(value => value + 1)}>{t('Retry')}</Button>} />
      : loading ? <div className="templates-grid" aria-busy="true">{[0, 1, 2].map(key => <div className="template-skeleton" key={key}><Skeleton active paragraph={{ rows: 6 }} /></div>)}</div>
      : !data?.items.length ? <div className="templates-empty"><Empty description={t(communityEmpty ? 'No community workflows have been published yet. Start with an official template.' : pageOutOfRange ? 'No workflows on this page.' : filtered ? 'No matching workflows. Try another search or clear your filters.' : 'No published workflows yet. Check back soon.')} />
        {communityEmpty ? <Button type="primary" onClick={() => setSearch({ source: 'official' })}>{t('Browse official templates')}</Button> : pageOutOfRange ? <Button onClick={() => update('page', '1')}>{t('Back to first page')}</Button> : filtered && <Button onClick={() => setSearch({})}>{t('Clear filters')}</Button>}</div>
      : <><div className="templates-grid">{data.items.map(template => <article className="template-card" key={template.id}>
        <Link className="template-card-visual" to={`/templates/${template.id}`} state={detailState} aria-label={`${t('View details')}: ${template.name}`}>
          <TemplateCover url={template.thumbnail} name={template.name} nodeCount={template.nodeCount} />
          <Tag className="template-category">{t(template.category)}</Tag>
        </Link>
        <div className="template-card-body"><div className="template-attribution"><span className={`template-source ${template.source}`}>{t(template.source === 'community' ? 'Community' : 'Official')}</span>
          <span>{template.authorName || t(template.source === 'community' ? 'Community creator' : 'Model Hub team')}</span></div>
          <h3><Link to={`/templates/${template.id}`} state={detailState}>{template.name}</Link></h3>
          <p className="template-description">{template.description || t('Open the details to explore this workflow.')}</p>
          <div className="template-tags">{template.tags.slice(0, 3).map(tag => <Tag key={tag}>{tag}</Tag>)}</div>
          <div className="template-card-meta"><span>{template.nodeCount} {t('nodes')} · {template.models.length} {t('models')}</span><span>{t('Updated')} {templateDate(template.updatedAt, locale)}</span></div>
          <div className="template-card-actions"><Link to={`/templates/${template.id}`} state={detailState}>{t('View details')} <ArrowRightOutlined /></Link>
            <Button type="primary" icon={<CopyOutlined />} loading={copyingId === template.id} disabled={!!copyingId && copyingId !== template.id} onClick={() => void copyTemplate(template.id)}>{t('Use template')}</Button></div>
        </div>
      </article>)}</div><Pagination className="templates-pagination" current={page} pageSize={pageSize} total={data.total} showSizeChanger={false} hideOnSinglePage onChange={value => update('page', String(value))} /></>}
  </div>;
}
