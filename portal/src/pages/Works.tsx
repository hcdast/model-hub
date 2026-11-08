import { Button, Tabs } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { PlusOutlined } from '@ant-design/icons';
import { useI18n } from '../i18n';
import ShortDramaList from './ShortDramaList';
import WorkflowList from './WorkflowList';
import TemplateSubmissions from './TemplateSubmissions';
import './Creation.css';

export default function Works() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const type = ['workflow', 'submissions'].includes(params.get('type') || '') ? params.get('type')! : 'short-drama';
  return <div className="creation-page">
    <header className="creation-heading"><div><h1>{t('My works')}</h1><p>{t('Continue your projects, reuse your materials and create again.')}</p></div><Link to="/create"><Button type="primary" icon={<PlusOutlined />}>{t('Start creating')}</Button></Link></header>
    <Tabs destroyInactiveTabPane activeKey={type} onChange={value => { const next = new URLSearchParams(params); next.set('type', value); setParams(next); }} items={[
      { key: 'short-drama', label: t('Short drama projects'), children: <ShortDramaList key={`drama:${params.get('search') || ''}`} mode="library" /> },
      { key: 'workflow', label: t('Professional workflows'), children: <WorkflowList key={`workflow:${params.get('search') || ''}`} embedded /> },
      { key: 'submissions', label: t('Template submissions'), children: <TemplateSubmissions /> },
    ]} />
  </div>;
}
