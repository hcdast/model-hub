import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Empty, Input, Pagination, Select, Skeleton, Tag } from 'antd';
import { AppstoreOutlined, ArrowRightOutlined, AudioOutlined, BookOutlined, FileTextOutlined, PictureOutlined, SearchOutlined, UnorderedListOutlined, UserOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useCatalog } from '../hooks/useCatalog';
import { useI18n } from '../i18n';
import { CatalogModel, modelDocKey, modelDocPath } from '../services/catalog-api';
import { catalogGroup, catalogGroups, catalogGroupLabels, catalogVisualIndex, CatalogGroup } from '../utils/catalog-presentation';
import landscape from '../assets/home/landscape.svg';
import product from '../assets/home/product.svg';
import orbit from '../assets/home/orbit.svg';
import city from '../assets/home/city.svg';
import audio from '../assets/home/audio.svg';
import editorial from '../assets/home/editorial.svg';
import portrait from '../assets/home/portrait.svg';
import '../styles/catalog.css';
import './Models.css';

const pageSize = 24;
const groupIcons = { all: AppstoreOutlined, image: PictureOutlined, video: VideoCameraOutlined, audio: AudioOutlined, text: FileTextOutlined, character: UserOutlined, other: AppstoreOutlined };
const covers = { image: [product, landscape, editorial], video: [landscape, city, orbit], audio: [audio], text: [editorial], character: [portrait], other: [orbit] };

function ModelVisual({ model }: { model: CatalogModel }) {
  const group = catalogGroup(model.model_type);
  const Icon = groupIcons[group];
  const name = model.model_name || model.model_id;
  const cover = group === 'video' && /^Akool\b/i.test(name) ? landscape
    : group === 'image' && model.model_type === 'imageToImage' ? product
    : covers[group][catalogVisualIndex(model.model_id, model.model_name, covers[group].length)];
  return <div className={`collection-cover collection-tone-${group}`}>
    <img src={cover} alt="" loading="lazy" />
    <span className="collection-cover-icon"><Icon /></span>
    <span className="collection-family">{name.split(/[\s/]+/)[0]}</span>
  </div>;
}

export default function Models() {
  const { models, loading, error, retry } = useCatalog();
  const { t } = useI18n();
  const [search, setSearch] = useSearchParams();
  const query = search.get('search') || '';
  const provider = search.get('provider') || '';
  const type = search.get('type') || '';
  const category = search.get('category') || '';
  const order = search.get('order') || 'default';
  const listView = search.get('view') === 'list';
  const requestedPage = Number(search.get('page'));
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page' && key !== 'view') next.delete('page');
    if (key === 'type') next.delete('category');
    setSearch(next, { replace: true });
  };
  const selectCategory = (value: CatalogGroup) => {
    const next = new URLSearchParams(search);
    if (value === 'all') next.delete('category'); else next.set('category', value);
    next.delete('type');
    next.delete('page');
    setSearch(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(search);
    ['search', 'provider', 'type', 'category', 'page'].forEach(key => next.delete(key));
    setSearch(next, { replace: true });
  };
  const providers = useMemo(() => [...new Set(models.map(model => model.provider).filter(Boolean))].sort(), [models]);
  const types = useMemo(() => [...new Set(models.map(model => model.model_type))].sort(), [models]);
  const groupCounts = useMemo(() => {
    const counts = { all: models.length, image: 0, video: 0, audio: 0, text: 0, character: 0 };
    models.forEach(model => { const group = catalogGroup(model.model_type); if (group !== 'other') counts[group]++; });
    return counts;
  }, [models]);
  const filtered = useMemo(() => {
    const text = query.toLocaleLowerCase().trim();
    const result = models.filter(model => (!provider || model.provider === provider) && (!type || model.model_type === type) &&
      (!category || catalogGroup(model.model_type) === category) &&
      (!text || [model.model_id, model.model_name, model.description, model.provider, ...model.tags].join(' ').toLocaleLowerCase().includes(text)));
    return order === 'name' ? result.sort((a, b) => (a.model_name || a.model_id).localeCompare(b.model_name || b.model_id)) : result;
  }, [models, query, provider, type, category, order]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const activeCategory = type ? catalogGroup(type) : category || 'all';
  const categoryLabel = catalogGroups.includes(category as CatalogGroup) ? catalogGroupLabels[category as CatalogGroup] : 'All models';
  const resultLabel = type ? t(type) : t(categoryLabel);
  const count = (value: number) => loading || error ? '—' : value;

  return <div className="catalog-page models-collection">
    <header className="catalog-page-heading collection-heading">
      <div><p className="collection-eyebrow">MODEL LIBRARY</p><h1>{t('Models')}</h1><p>{t('Explore models for your next creation.')}</p></div>
      <Link to="/docs"><Button icon={<BookOutlined />}>{t('Read documentation')}</Button></Link>
    </header>
    <div className="collection-summary" aria-live="polite">
      <span><strong>{count(models.length)}</strong>{t('Model configurations')}</span>
      <span><strong>{count(providers.length)}</strong>{t('Providers')}</span>
      <span><strong>{count(types.length)}</strong>{t('Capabilities')}</span>
      <p>{t('The same model can be available from different providers.')}</p>
    </div>

    <section className="collection-categories" aria-label={t('Explore by capability')}>
      {catalogGroups.map(group => {
        const Icon = groupIcons[group];
        return <button key={group} type="button" className={`collection-category collection-tone-${group}`} aria-pressed={activeCategory === group} onClick={() => selectCategory(group)}>
          <span className="collection-category-icon"><Icon /></span><span>{t(catalogGroupLabels[group])}</span><strong>{count(groupCounts[group])}</strong>
        </button>;
      })}
    </section>

    <div className="catalog-toolbar collection-toolbar">
      <Input aria-label={t('Search models...')} prefix={<SearchOutlined />} placeholder={t('Search models...')} value={query} allowClear onChange={event => update('search', event.target.value)} />
      <Select aria-label={t('Provider')} value={provider} onChange={value => update('provider', value)} options={[{ value: '', label: t('All providers') }, ...providers.map(value => ({ value, label: value }))]} />
      <Select aria-label={t('Capability')} value={type} onChange={value => update('type', value)} options={[{ value: '', label: t('All capabilities') }, ...types.map(value => ({ value, label: t(value) }))]} />
      <Select aria-label={t('Default order')} value={order} onChange={value => update('order', value)} options={[{ value: 'default', label: t('Default order') }, { value: 'name', label: t('Name A–Z') }]} />
    </div>
    <div className="catalog-results collection-results">
      <h2>{resultLabel} <span>{count(filtered.length)}</span></h2>
      <div className="collection-result-actions">
        {(query || provider || type || category) && <Button type="link" onClick={clearFilters}>{t('Clear filters')}</Button>}
        <div className="collection-view-switch" role="group" aria-label={t('Display mode')}>
          <button type="button" aria-label={t('Grid view')} title={t('Grid view')} aria-pressed={!listView} onClick={() => update('view', '')}><AppstoreOutlined /></button>
          <button type="button" aria-label={t('List view')} title={t('List view')} aria-pressed={listView} onClick={() => update('view', 'list')}><UnorderedListOutlined /></button>
        </div>
      </div>
    </div>
    <p className="collection-illustration-note">{t('Capability illustrations, not model-generated samples.')}</p>
    {error ? <Alert type="error" showIcon message={t('Unable to load models')} description={t('Please try again later.')} action={<Button onClick={retry}>{t('Retry')}</Button>} /> :
      loading ? <div className="collection-grid">{Array.from({ length: 8 }, (_, index) => <div className="collection-card collection-skeleton" key={index}><Skeleton active /></div>)}</div> :
      !filtered.length ? <Empty description={<><p>{t('No models found')}</p><p>{t(models.length ? 'Try another search or clear the filters.' : 'No models are available yet.')}</p></>} /> :
      <div className={listView ? 'collection-list' : 'collection-grid'}>{filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(model => {
        const group = catalogGroup(model.model_type);
        return <Link className={`collection-card collection-tone-${group}`} key={modelDocKey(model)} to={modelDocPath(model)}>
          <ModelVisual model={model} />
          <div className="collection-card-content">
            <div className="collection-card-meta"><span className="collection-provider"><i />{model.provider}</span><span className="collection-capability">{t(model.model_type)}</span></div>
            <h3>{model.model_name || model.model_id}</h3><code className="collection-model-id" title={model.model_id}>{model.model_id}</code>
            <p className="collection-description">{model.description || `${t(model.model_type)} · ${model.provider}`}</p>
            {model.tags.length > 0 && <div className="collection-tags">{model.tags.slice(0, 2).map(tag => <Tag key={tag}>{tag}</Tag>)}</div>}
            <div className="collection-card-footer"><span>{t('View docs')}</span><ArrowRightOutlined /></div>
          </div>
        </Link>;
      })}</div>}
    {!loading && !error && filtered.length > pageSize && <Pagination className="catalog-pagination" current={currentPage} pageSize={pageSize} total={filtered.length} showSizeChanger={false} onChange={value => update('page', String(value))} />}
  </div>;
}
