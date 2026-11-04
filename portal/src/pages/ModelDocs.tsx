import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Empty, Input, Pagination, Select, Skeleton } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, AudioOutlined, BookOutlined, CodeOutlined, FileTextOutlined, PictureOutlined, SearchOutlined, UserOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useCatalog } from '../hooks/useCatalog';
import { useProtectedNavigate } from '../hooks/useProtectedNavigate';
import { useI18n } from '../i18n';
import { catalogApi, CatalogModelDoc, modelDocKey, modelDocPath } from '../services/catalog-api';
import { catalogGroup, catalogGroups, catalogGroupLabels, type CatalogGroup } from '../utils/catalog-presentation';
import ModelReference from '../components/Docs/ModelReference';
import DocsCodeBlock from '../components/Docs/DocsCodeBlock';
import '../styles/catalog.css';
import './ModelDocs.css';

const icons = { all: <BookOutlined />, image: <PictureOutlined />, video: <VideoCameraOutlined />, audio: <AudioOutlined />, text: <FileTextOutlined />, character: <UserOutlined />, other: <CodeOutlined /> };
const PAGE_SIZE = 14;

export default function ModelDocs() {
  const { id } = useParams();
  const [search, setSearch] = useSearchParams();
  const type = search.get('type');
  const provider = search.get('provider');
  const configId = search.get('config');
  const navigate = useNavigate();
  const location = useLocation();
  const { openFeature, loginPrompt } = useProtectedNavigate();
  const { t, locale } = useI18n();
  const l = (zh: string, en: string, ja = en) => locale === 'zh' ? zh : locale === 'ja' ? ja : en;
  const { models, loading: catalogLoading, error: catalogError, retry: retryCatalog } = useCatalog();
  const [doc, setDoc] = useState<CatalogModelDoc | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [navigationSearch, setNavigationSearch] = useState('');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const filter = search.get('q') || '';
  const group: CatalogGroup = catalogGroups.includes(search.get('category') as CatalogGroup) ? search.get('category') as CatalogGroup : 'all';
  const providerFilter = search.get('vendor') || 'all';
  const changeFilters = (updates: Record<string, string>) => {
    const next = new URLSearchParams(search);
    Object.entries(updates).forEach(([key, value]) => value && !(value === 'all' && ['category', 'vendor'].includes(key)) ? next.set(key, value) : next.delete(key));
    next.delete('page'); setSearch(next, { replace: true }); setNavigationOpen(false);
  };
  useEffect(() => {
    if (!id) { setDoc(null); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(false); setDoc(null);
    catalogApi.detail(id, type, controller.signal, provider, configId).then(data => {
      if (!controller.signal.aborted) setDoc(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, type, provider, configId, attempt]);
  useEffect(() => {
    setExpandedGroup(null); setNavigationOpen(false);
    bodyRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [id, type, provider, configId]);
  const matches = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());
  const visibleModels = models.filter(model => (group === 'all' || catalogGroup(model.model_type) === group)
    && (providerFilter === 'all' || model.provider === providerFilter)
    && matches(`${model.model_name} ${model.model_id} ${model.provider} ${t(model.model_type)}`, filter));
  const pageCount = Math.max(1, Math.ceil(visibleModels.length / PAGE_SIZE));
  const requestedPage = Number(search.get('page')) || 1;
  const page = Math.max(1, Math.min(pageCount, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const providers = [...new Set(models.map(model => model.provider))].sort();
  const selectedGroup = doc ? catalogGroup(doc.model_type) : type ? catalogGroup(type) : 'all';
  const categoryCounts = (key: string) => models.filter(model => key === 'all' || catalogGroup(model.model_type) === key).length;
  const scrollToModels = () => document.getElementById('reference-models')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return <div className="reference-page">
    {loginPrompt}
    <aside className="reference-sidebar">
      <div className={`reference-navigation ${navigationOpen ? 'is-open' : ''}`}>
        <button className="reference-mobile-navigation" aria-expanded={navigationOpen} aria-controls="reference-navigation-body" onClick={() => setNavigationOpen(value => !value)}><BookOutlined /> {l('文档导航', 'Documentation navigation', 'ドキュメントナビゲーション')}<span>⌄</span></button>
        <div className="reference-navigation-body" id="reference-navigation-body">
          <Link to="/docs" className="reference-brand"><span className="reference-brand-icon"><BookOutlined /></span><div><strong>{l('开发者文档', 'Documentation', 'ドキュメント')}</strong><span>MODEL HUB API</span></div></Link>
          <nav aria-label={l('文档导航', 'Documentation navigation', 'ドキュメントナビゲーション')} className="reference-quick-nav">
            <Link to="/docs" aria-current={!id ? 'page' : undefined}><BookOutlined />{t('Model documentation')}</Link>
            <button onClick={() => id ? navigate({ pathname: location.pathname, search: search.toString(), hash: 'api' }, { replace: true }) : document.getElementById('reference-get-started')?.scrollIntoView({ behavior: 'smooth' })}><CodeOutlined />{l('快速接入', 'Quickstart', 'クイックスタート')}</button>
            <button onClick={() => openFeature('/settings/api-keys')}><span className="reference-key-symbol">⌘</span>{t('API Keys')}<ArrowRightOutlined /></button>
          </nav>
          <div className="reference-nav-heading">{l('模型参考', 'MODEL REFERENCE', 'モデルリファレンス')}</div>
          {id && <Input size="small" prefix={<SearchOutlined />} allowClear placeholder={t('Search models...')} aria-label={l('搜索文档导航', 'Search documentation navigation', 'ナビゲーションを検索')} value={navigationSearch} onChange={event => setNavigationSearch(event.target.value)} />}
          <nav className="reference-categories" aria-label={l('模型分类', 'Model categories', 'モデルカテゴリ')}>
            {(id ? [...catalogGroups.filter(key => key !== 'all'), ...(models.some(model => catalogGroup(model.model_type) === 'other') ? ['other' as const] : [])] : catalogGroups).map(key => {
              const nestedModels = models.filter(model => catalogGroup(model.model_type) === key && matches(`${model.model_name} ${model.model_id} ${model.provider}`, navigationSearch));
              const expanded = expandedGroup === key || (expandedGroup === null && selectedGroup === key) || !!navigationSearch.trim();
              return <div key={key}><button className={`reference-category ${(!id && group === key) || (id && selectedGroup === key) ? 'is-active' : ''}`} aria-current={!id && group === key ? 'true' : undefined} aria-expanded={id ? expanded : undefined} onClick={() => id ? setExpandedGroup(expanded ? '' : key) : changeFilters({ category: key })}>
                {icons[key]}<span>{key === 'other' ? l('其他', 'Other', 'その他') : t(catalogGroupLabels[key])}</span><small>{categoryCounts(key)}</small>
              </button>{id && expanded && nestedModels.map(model => <Link className={`reference-nav-model ${doc && modelDocKey(doc) === modelDocKey(model) ? 'is-active' : ''}`} aria-current={doc && modelDocKey(doc) === modelDocKey(model) ? 'page' : undefined} title={`${model.model_name} · ${model.provider} · ${model.model_id}`} key={modelDocKey(model)} to={modelDocPath(model)}><span>{model.model_name || model.model_id}</span><small>{model.provider} · {t(model.model_type)}</small></Link>)}</div>;
            })}
          </nav>
          <Link to="/models" className="reference-back"><ArrowLeftOutlined />{t('Back to models')}</Link>
        </div>
      </div>
    </aside>
    <div className="reference-body" ref={bodyRef}>
      <div className="reference-breadcrumb"><Link to="/docs">{l('开发者文档', 'Documentation', 'ドキュメント')}</Link><span>/</span><span>{id ? doc?.model_name || t('Model documentation') : l('模型参考', 'Model reference', 'モデルリファレンス')}</span><span className="reference-api-badge">REST API</span></div>
      {!id ? <div className="reference-workspace reference-index-layout"><main className="reference-main">
        <header className="reference-heading"><div className="reference-eyebrow">MODEL REFERENCE</div><h1>{t('Model documentation')}</h1><p>{l('从模型能力到 API 调用，在这里找到所需的一切。', 'Explore model capabilities, input schemas, and working API examples.', 'モデルの機能、入力スキーマ、API サンプルを確認できます。')}</p></header>
        <div className="reference-intro-strip"><span><CodeOutlined /></span><div><strong>{l('一套 API，接入多种模型', 'One API, multiple models', '一つの API で多様なモデルへ')}</strong><p>{l('统一创建任务、查询结果。选择模型，查看专属参数和请求示例。', 'Create tasks and retrieve results with a unified API. Choose a model to see its parameters and examples.', '統一 API でタスクを作成し、結果を取得。モデルごとのパラメータとサンプルを確認。')}</p></div></div>
        <section id="reference-models" className="reference-directory">
          <div className="reference-directory-heading"><h2>{group === 'all' ? l('浏览模型', 'Browse models', 'モデルを探す') : t(catalogGroupLabels[group])}<span>{catalogLoading ? '…' : visibleModels.length}</span></h2><span>{l('公开文档 · 无需登录', 'Public docs · No sign-in required', '公開ドキュメント · ログイン不要')}</span></div>
          <div className="reference-filters"><Input prefix={<SearchOutlined />} aria-label={t('Search models...')} placeholder={l('搜索模型名称、标识或供应商…', 'Search models, IDs, or providers…', 'モデル名、ID、プロバイダーを検索…')} value={filter} allowClear onChange={event => changeFilters({ q: event.target.value })} />
            <Select showSearch optionFilterProp="label" aria-label={l('筛选供应商', 'Filter by provider', 'プロバイダーで絞り込み')} value={providerFilter} onChange={value => changeFilters({ vendor: value })} options={[{ value: 'all', label: l('全部供应商', 'All providers', '全プロバイダー') }, ...providers.map(value => ({ value, label: value }))]} /></div>
          {catalogError ? <Alert type="error" message={t('Unable to load models')} action={<Button onClick={retryCatalog}>{t('Retry')}</Button>} /> : catalogLoading ? <Skeleton active paragraph={{ rows: 9 }} /> : visibleModels.length ? <>
            <div className="reference-model-list"><div className="reference-list-labels"><span>{l('模型 / 标识', 'MODEL / ID', 'モデル / ID')}</span><span>{t('Capability')}</span><span>{t('Provider')}</span><span /></div>
              {visibleModels.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(model => <Link key={modelDocKey(model)} className="reference-model-row" to={modelDocPath(model)}><span className={`reference-model-symbol is-${catalogGroup(model.model_type)}`}>{icons[catalogGroup(model.model_type)]}</span><div className="reference-model-name"><strong>{model.model_name || model.model_id}</strong><code>{model.model_id}</code></div><span className="reference-capability">{t(model.model_type)}</span><span className="reference-provider">{model.provider}</span><ArrowRightOutlined className="reference-row-arrow" /></Link>)}
            </div><div className="reference-pagination"><span>{l(`第 ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, visibleModels.length)} 项，共 ${visibleModels.length} 项`, `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, visibleModels.length)} of ${visibleModels.length} models`)}</span><Pagination size="small" current={page} pageSize={PAGE_SIZE} total={visibleModels.length} showSizeChanger={false} onChange={value => { const next = new URLSearchParams(search); next.set('page', String(value)); setSearch(next); scrollToModels(); }} /></div>
          </> : <div className="reference-empty"><Empty description={t('No models found')} /><Button onClick={() => changeFilters({ q: '', category: 'all', vendor: 'all' })}>{l('清除筛选', 'Clear filters', '絞り込みを解除')}</Button></div>}
        </section>
      </main><aside className="reference-aside"><div className="reference-sticky" id="reference-get-started"><div className="reference-aside-label">{l('快速开始', 'QUICKSTART', 'クイックスタート')}</div><h3>{l('开始第一次调用', 'Make your first request', '最初のリクエスト')}</h3><ol className="reference-steps"><li><button onClick={() => openFeature('/settings/api-keys')}>{l('创建 API Key', 'Create an API key', 'API キーを作成')}<ArrowRightOutlined /></button><p>{l('在个人设置中创建密钥，用于请求认证。', 'Create a key in your settings to authenticate requests.', '設定で認証用のキーを作成。')}</p></li><li><button onClick={scrollToModels}>{l('选择所需模型', 'Choose a model', 'モデルを選択')}<ArrowRightOutlined /></button><p>{l('查看输入参数，复制对应的 API 示例。', 'Review input parameters and copy an API example.', '入力パラメータと API サンプルを確認。')}</p></li><li><strong>{l('提交任务并获取结果', 'Submit and get results', 'タスクを作成し結果を取得')}</strong><p>{l('使用 taskId 查询状态，直到任务完成。', 'Poll with the taskId until the task finishes.', '完了するまで taskId で状態を確認。')}</p></li></ol><DocsCodeBlock language="HTTP" code={'POST /v1/tasks\nX-API-Key: <your-api-key>\nContent-Type: application/json'} /><div className="reference-security-note"><strong>{t('Authentication')}</strong><p>{t('Send your API key in the X-API-Key header. Never expose it in browser code.')}</p></div></div></aside></div>
        : loading ? <Skeleton active paragraph={{ rows: 12 }} /> : error || !doc ? <Alert type="error" showIcon message={t('Unable to load documentation')} description={t('This model is unavailable or no longer exists.')} action={<Button onClick={() => setAttempt(value => value + 1)}>{t('Retry')}</Button>} /> : <ModelReference key={`${modelDocKey(doc)}:${doc.revision}`} doc={doc} openFeature={openFeature} />}
    </div>
  </div>;
}
