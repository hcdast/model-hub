import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { Alert, Button, Empty, Result, Skeleton, Tag } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, CopyOutlined, ApartmentOutlined } from '@ant-design/icons';
import ReactFlow, { Background, Controls, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import { useI18n } from '../i18n';
import { useTemplateCopy } from '../hooks/useTemplateCopy';
import { TemplateCover, TemplateMedia } from '../components/Templates/TemplateMedia';
import { TemplateDetail as Detail, templateCatalogApi, templateDate, templateGraphNodes, templateScenarios } from '../services/template-api';
import './Templates.css';

export default function TemplateDetail() {
  const { id = '' } = useParams();
  const location = useLocation();
  const discovery = location.state?.discovery;
  const backTo = typeof discovery === 'string' && /^\/discover(?:\?|$)/.test(discovery) ? discovery : '/discover';
  const { t, locale } = useI18n();
  const [template, setTemplate] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'missing' | 'failed' | null>(null);
  const [revision, setRevision] = useState(0);
  const { copyTemplate, copyingId, loginPrompt } = useTemplateCopy();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setTemplate(null); setError(null);
    templateCatalogApi.detail(id, controller.signal).then(data => { if (!controller.signal.aborted) setTemplate(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(isAxiosError(reason) && reason.response?.status === 404 ? 'missing' : 'failed'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);
  const graphNodes = useMemo(() => template ? templateGraphNodes(template).map(node => ({ ...node, sourcePosition: Position.Right, targetPosition: Position.Left })) : [], [template]);
  const graphEdges = useMemo(() => template?.graph.edges.map(edge => ({ ...edge, style: { stroke: '#8c8edb', strokeWidth: 2 }, labelStyle: { fill: '#e2e8f0' }, labelBgStyle: { fill: '#1e1e35' } })) || [], [template]);
  if (loading) return <div className="templates-page"><Skeleton active paragraph={{ rows: 12 }} /></div>;
  if (error === 'missing') return <Result status="404" title={t('Template unavailable')} subTitle={t('This template does not exist or is no longer published.')} extra={<Link to="/discover"><Button type="primary">{t('Back to discovery')}</Button></Link>} />;
  if (error || !template) return <div className="templates-page"><Alert type="error" showIcon message={t('Unable to load templates. Please try again.')} action={<Button onClick={() => setRevision(value => value + 1)}>{t('Retry')}</Button>} /><Link className="template-back" to="/discover">{t('Back to discovery')}</Link></div>;
  const scenario = templateScenarios.find(([key]) => key === template.scenario)?.[1];
  return <div className="templates-page template-detail">
    {loginPrompt}
    <Link className="template-back" to={backTo}><ArrowLeftOutlined /> {t('Back to discovery')}</Link>
    <div className="template-detail-layout">
      <div className="template-detail-main">
        <header className="template-detail-heading"><div className="template-attribution"><span className={`template-source ${template.source}`}>{t(template.source === 'community' ? 'Community' : 'Official')}</span><span>{template.authorName || t(template.source === 'community' ? 'Community creator' : 'Model Hub team')}</span><span>v{template.version}</span></div>
          <h1>{template.name}</h1><p>{template.description}</p>
          <div className="template-tags"><Tag>{t(template.category)}</Tag>{scenario && <Tag>{t(scenario)}</Tag>}{template.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>
          <div className="template-mobile-use"><Button block size="large" type="primary" icon={<CopyOutlined />} loading={!!copyingId} onClick={() => void copyTemplate(template.id)}>{t('Copy & edit workflow')}</Button><p>{t('Copying does not start a run. Model usage is charged when you run the workflow.')}</p></div>
        </header>
        <section className="template-section"><h2>{t('Example results')}</h2>
          {template.examples.length ? <div className="template-examples">{template.examples.map((example, index) => <article key={index} className="template-example">
            <h3>{example.title}</h3><div className={`template-comparison ${example.inputUrl ? 'has-input' : ''}`}>
              {example.inputUrl && <figure><figcaption>{t('Example input')}</figcaption><TemplateMedia url={example.inputUrl} type={example.inputMediaType || example.mediaType} label={`${example.title} — ${t('Example input')}`} /></figure>}
              <figure><figcaption>{t('Example output')}</figcaption><TemplateMedia url={example.outputUrl} type={example.mediaType} label={`${example.title} — ${t('Example output')}`} /></figure>
            </div>{example.description && <p>{example.description}</p>}</article>)}</div>
            : <><TemplateCover url={template.thumbnail} name={template.name} nodeCount={template.nodeCount} /><p className="template-muted">{t('The author has not added example results yet. Explore the workflow below before copying.')}</p></>}
        </section>
        <section className="template-section"><h2><ApartmentOutlined /> {t('Workflow preview')}</h2><p>{t('Explore the steps and connections before opening your own editable copy.')}</p>
          {graphNodes.length ? <div className="template-graph" aria-label={t('Read-only workflow graph')}><ReactFlow key={id} nodes={graphNodes} edges={graphEdges} fitView fitViewOptions={{ padding: 0.25 }} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false} deleteKeyCode={null} zoomOnScroll={false} minZoom={0.05} maxZoom={2}><Background color="#383951" gap={22} /><Controls showInteractive={false} /></ReactFlow></div>
            : <Empty description={t('No workflow steps available')} />}
          {template.models.length > 0 && <div className="template-models"><h3>{t('Models in this workflow')}</h3>{template.models.map(model => <Link key={model} to={`/models?search=${encodeURIComponent(model)}`}><Tag>{model} <ArrowRightOutlined /></Tag></Link>)}</div>}
        </section>
        <section className="template-section"><h2>{t('Inputs & outputs')}</h2><div className="template-io-grid">
          <div><h3>{t('What you provide')}</h3>{template.inputs.length ? <ul>{template.inputs.map(input => <li key={input.name}><strong>{input.name}</strong><span>{t(({ image: 'Image', video: 'Video', audio: 'Audio', text: 'Text' } as Record<string, string>)[input.type] || input.type)} · {t(input.required ? 'Required' : 'Optional')}</span></li>)}</ul> : <p>{t('Configure inputs and model parameters in your copy of the workflow.')}</p>}</div>
          <div><h3>{t('What you get')}</h3>{template.outputs.length ? <ul>{template.outputs.map(output => <li key={output}><strong>{output}</strong></li>)}</ul> : <p>{t('Inspect the output nodes and results in the workflow editor.')}</p>}</div>
        </div></section>
        <section className="template-section"><h2>{t('How to use')}</h2>{template.instructions ? <p className="template-instructions">{template.instructions}</p> : <ol className="template-instructions-list"><li>{t('Copy this template to your workflows.')}</li><li>{t('Add your materials and adjust the model parameters.')}</li><li>{t('Validate the workflow, then run and review your results.')}</li></ol>}</section>
      </div>
      <aside className="template-use-panel"><h2>{t('Make this workflow yours')}</h2><p>{t('Create an editable copy in your account. You can customize it before running.')}</p>
        <Button block size="large" type="primary" icon={<CopyOutlined />} loading={!!copyingId} onClick={() => void copyTemplate(template.id)}>{t('Copy & edit workflow')}</Button>
        <p className="template-copy-note">{t('Copying does not start a run. Model usage is charged when you run the workflow.')}</p>
        <dl><div><dt>{t('Workflow steps')}</dt><dd>{template.nodeCount}</dd></div><div><dt>{t('Models used')}</dt><dd>{template.models.length}</dd></div><div><dt>{t('Version')}</dt><dd>v{template.version}</dd></div><div><dt>{t('Updated')}</dt><dd>{templateDate(template.updatedAt, locale)}</dd></div></dl>
        <div className="template-getting-started"><h3>{t('Before you run')}</h3><p>{t('Check the required inputs, model access and your account balance in the editor.')}</p></div>
      </aside>
    </div>
  </div>;
}
