import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Modal, Skeleton } from 'antd';
import {
  ArrowRightOutlined, PlusOutlined, PictureOutlined, VideoCameraOutlined,
  AudioOutlined, FileTextOutlined, NodeIndexOutlined, BookOutlined,
  ApiOutlined, ClockCircleOutlined, ArrowUpOutlined,
} from '@ant-design/icons';
import { useI18n } from '../i18n';
import { homeCopy } from '../i18n/home';
import { useCatalog } from '../hooks/useCatalog';
import { useProtectedNavigate } from '../hooks/useProtectedNavigate';
import { modelDocKey, modelDocPath } from '../services/catalog-api';
import { workflowApi } from '../services/workflow-api';
import { useAuthStore } from '../store/auth-store';
import landscape from '../assets/home/landscape.svg';
import product from '../assets/home/product.svg';
import orbit from '../assets/home/orbit.svg';
import audio from '../assets/home/audio.svg';
import editorial from '../assets/home/editorial.svg';
import './Home.css';
import BrandIcon from '../components/BrandIcon';

const scenes = [
  { cover: product, type: 'textToImage', category: 1, icon: PictureOutlined },
  { cover: orbit, type: 'textToVideo', category: 2, icon: VideoCameraOutlined },
  { cover: audio, type: 'tts', category: 3, icon: AudioOutlined },
  { cover: editorial, type: 'textGenerate', category: 4, icon: FileTextOutlined },
];
const guideIcons = [NodeIndexOutlined, BookOutlined, ApiOutlined];
interface RecentWorkflow { _id: string; name: string; nodes?: unknown[]; updatedAt?: string }

export default function Home() {
  const { locale, t } = useI18n();
  const copy = homeCopy[locale];
  const { models, loading, error, retry } = useCatalog();
  const { openFeature, loginPrompt } = useProtectedNavigate();
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const [category, setCategory] = useState(0);
  const [guide, setGuide] = useState<number | null>(null);
  const [workflows, setWorkflows] = useState<RecentWorkflow[]>([]);
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [workflowError, setWorkflowError] = useState(false);
  const [workflowAttempt, setWorkflowAttempt] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) { setWorkflows([]); return; }
    let active = true;
    setWorkflowLoading(true);
    setWorkflowError(false);
    workflowApi.list({ page: 1, pageSize: 3 }).then(res => {
      if (active) setWorkflows(res.data?.items || []);
    }).catch(() => {
      if (active) setWorkflowError(true);
    }).finally(() => {
      if (active) setWorkflowLoading(false);
    });
    return () => { active = false; };
  }, [isAuthenticated, workflowAttempt]);

  // Represent different capabilities without inventing popularity or usage figures.
  const featured = useMemo(() => {
    const selected = scenes.map(scene => models.find(model => model.model_type === scene.type))
      .filter((model): model is (typeof models)[number] => Boolean(model));
    const keys = new Set(selected.map(modelDocKey));
    return [...selected, ...models.filter(model => !keys.has(modelDocKey(model)))].slice(0, 4);
  }, [models]);
  const metrics = [models.length, new Set(models.map(model => model.model_type)).size, new Set(models.map(model => model.provider)).size];
  const dateFormatter = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en', { month: 'short', day: 'numeric' });
  const activeGuide = guide === null ? null : copy.guides[guide];

  return (
    <div className="home-page">
      {loginPrompt}
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p className="home-eyebrow"><span />{copy.eyebrow}</p>
          <h1 id="home-title">{copy.title[0]}<br /><span>{copy.title[1]}</span></h1>
          <p className="home-intro">{copy.intro}</p>
          <div className="home-actions">
            <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => openFeature('/workflows/new')}>{copy.create}</Button>
            <Link className="home-secondary-button" to="/models">{copy.explore}<ArrowRightOutlined /></Link>
          </div>
          <p className="home-access">{copy.access}</p>
        </div>
        <div className="home-hero-art">
          <figure className="home-main-art">
            <img src={landscape} alt="" fetchPriority="high" />
            <figcaption><span>STUDIO / 01</span><strong>{copy.preview}</strong></figcaption>
          </figure>
          <div className="home-art-inset"><img src={product} alt="" /><span>FORM & LIGHT</span></div>
          <div className="home-flow-preview" aria-label={`${copy.input} → ${copy.generate} → ${copy.output}`}>
            <span><FileTextOutlined />{copy.input}</span><ArrowRightOutlined /><span><NodeIndexOutlined />{copy.generate}</span><ArrowRightOutlined /><span><PictureOutlined />{copy.output}</span>
          </div>
          <p className="home-art-note">{copy.visualNote}</p>
        </div>
      </section>

      <div className="home-metrics" aria-label={copy.allModels}>
        {copy.metrics.map((label, index) => <div key={label}><strong>{loading || error ? '—' : metrics[index].toLocaleString(locale)}</strong><span>{label}</span></div>)}
        <Link to="/docs"><BookOutlined /><span>{copy.docs}</span><ArrowRightOutlined /></Link>
      </div>

      {isAuthenticated && <section className="home-section home-recent" aria-labelledby="home-recent-title">
        <div className="home-section-heading"><h2 id="home-recent-title">{copy.recent}</h2><Link to="/workflows">{copy.allWorkflows}<ArrowRightOutlined /></Link></div>
        {workflowLoading ? <Skeleton active paragraph={{ rows: 1 }} /> : workflowError ? <div className="home-state"><span>{copy.workflowError}</span><Button onClick={() => setWorkflowAttempt(value => value + 1)}>{copy.retry}</Button></div> : workflows.length ? <div className="home-workflow-grid">
          {workflows.map(workflow => {
            const updatedAt = workflow.updatedAt ? new Date(workflow.updatedAt) : null;
            return <Link key={workflow._id} to={`/workflows/${encodeURIComponent(workflow._id)}`} className="home-workflow"><NodeIndexOutlined /><div><h3>{workflow.name}</h3><p>{workflow.nodes?.length || 0} {copy.nodes}{updatedAt && !Number.isNaN(updatedAt.getTime()) && <> · {dateFormatter.format(updatedAt)}</>}</p></div><ArrowRightOutlined /></Link>;
          })}
        </div> : <div className="home-state"><span>{copy.emptyWorkflows}</span><Button icon={<PlusOutlined />} onClick={() => openFeature('/workflows/new')}>{copy.create}</Button></div>}
      </section>}

      <section className="home-section" aria-labelledby="home-scenes-title">
        <div className="home-section-heading"><div><p className="home-kicker">CREATE SOMETHING NEW</p><h2 id="home-scenes-title">{copy.scenesTitle}</h2><p>{copy.scenesIntro}</p></div>
          <div className="home-filters" role="group" aria-label={copy.scenesTitle}>{copy.categories.map((label, index) => <button key={label} type="button" aria-pressed={category === index} onClick={() => setCategory(index)}>{label}</button>)}</div>
        </div>
        <div className="home-scene-grid">
          {scenes.map((scene, index) => (category === 0 || category === scene.category) && <Link key={scene.type} to={`/models?type=${scene.type}`} className="home-scene-card">
            <div className="home-scene-cover"><img src={scene.cover} alt="" loading="lazy" /><span><scene.icon />{copy.categories[scene.category]}</span></div>
            <div className="home-scene-body"><p className="home-scene-steps">{copy.scenes[index].steps}</p><h3>{copy.scenes[index].title}</h3><p>{copy.scenes[index].description}</p><span className="home-card-link">{copy.discover}<ArrowRightOutlined /></span></div>
          </Link>)}
        </div>
        <p className="home-illustration-note">{copy.visualNote}</p>
      </section>

      <section className="home-section" aria-labelledby="home-models-title">
        <div className="home-section-heading"><div><p className="home-kicker">MEET YOUR MODELS</p><h2 id="home-models-title">{copy.modelsTitle}</h2><p>{copy.modelsIntro}</p></div><Link to="/models">{copy.allModels}<ArrowRightOutlined /></Link></div>
        {loading ? <div className="home-model-grid">{[0, 1, 2, 3].map(value => <div className="home-model-card" key={value}><Skeleton active paragraph={{ rows: 3 }} /></div>)}</div> : error ? <div className="home-state"><span>{copy.catalogError}</span><Button onClick={retry}>{copy.retry}</Button></div> : !featured.length ? <div className="home-state">{copy.catalogEmpty}</div> : <div className="home-model-grid">
          {featured.map((model, index) => {
            const Icon = scenes.find(scene => scene.type === model.model_type)?.icon || NodeIndexOutlined;
            return <Link to={modelDocPath(model)} className="home-model-card" key={modelDocKey(model)}>
              <div className="home-model-top"><span className={`home-model-icon home-model-icon-${index}`}><Icon /></span><span>{t(model.model_type)}</span></div>
              <h3>{model.model_name || model.model_id}</h3><p className="home-model-provider">{model.provider}</p><p className="home-model-description">{model.description || copy.noDescription}</p><span className="home-card-link">{copy.modelDoc}<ArrowRightOutlined /></span>
            </Link>;
          })}
        </div>}
      </section>

      <section className="home-section" aria-labelledby="home-resources-title">
        <div className="home-section-heading"><div><p className="home-kicker">A GOOD PLACE TO START</p><h2 id="home-resources-title">{copy.resourcesTitle}</h2><p>{copy.resourcesIntro}</p></div><Link to="/docs">{copy.docs}<ArrowRightOutlined /></Link></div>
        <div className="home-resource-grid">{copy.guides.map((item, index) => {
          const Icon = guideIcons[index];
          return <button type="button" className={`home-resource-card home-resource-${index}`} key={item.title} onClick={() => setGuide(index)}>
            <div className="home-resource-visual" aria-hidden="true"><span className="home-resource-number">0{index + 1}</span><Icon /><div className="home-resource-lines"><i /><i /><i /></div></div>
            <div className="home-resource-body"><p className="home-resource-meta">{copy.guideLabel}<span><ClockCircleOutlined />{item.duration}</span></p><h3>{item.title}</h3><p>{item.description}</p><span className="home-card-link">{copy.readGuide}<ArrowRightOutlined /></span></div>
          </button>;
        })}</div>
      </section>

      <section className="home-closing"><div><h2>{copy.closingTitle}</h2><p>{copy.closingBody}</p></div><Button size="large" type="primary" onClick={() => openFeature('/workflows/new')}>{copy.create}<ArrowRightOutlined /></Button></section>
      <footer className="home-footer"><Link to="/" className="home-footer-brand"><BrandIcon size={22} />Model Hub</Link><p>{copy.footer}</p><Link to="/docs">{copy.docs}<ArrowUpOutlined rotate={45} /></Link></footer>

      <Modal open={activeGuide !== null} onCancel={() => setGuide(null)} footer={null} width={700} title={activeGuide?.title} className="home-guide-modal">
        {activeGuide && <><p className="home-guide-intro">{activeGuide.description}</p><ol className="home-guide-steps">{activeGuide.steps.map(([title, body]) => <li key={title}><h3>{title}</h3><p>{body}</p></li>)}</ol><div className="home-actions"><Link className="home-secondary-button" to={guide === 0 ? '/models' : '/docs'} onClick={() => setGuide(null)}>{guide === 0 ? copy.explore : copy.docs}<ArrowRightOutlined /></Link>{guide === 0 && <Button type="primary" onClick={() => { setGuide(null); openFeature('/workflows/new'); }}>{copy.create}</Button>}</div></>}
      </Modal>
    </div>
  );
}
