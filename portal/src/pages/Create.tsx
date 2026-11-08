import { Button } from 'antd';
import { Link } from 'react-router-dom';
import { ApartmentOutlined, CompassOutlined } from '@ant-design/icons';
import ShortDramaList from './ShortDramaList';
import { useI18n } from '../i18n';
import { useProtectedNavigate } from '../hooks/useProtectedNavigate';
import './Creation.css';

export default function Create() {
  const { t } = useI18n();
  const { openFeature, loginPrompt } = useProtectedNavigate();
  return <div className="creation-page">
    {loginPrompt}
    <header className="creation-heading"><div><h1>{t('Start creating')}</h1><p>{t('Start with a story, a template or your own workflow.')}</p></div><Link to="/works"><Button>{t('My works')}</Button></Link></header>
    <ShortDramaList mode="create" />
    <div className="creation-options">
      <section><CompassOutlined /><h2>{t('Start from a template')}</h2><p>{t('Preview a story structure, then make it your own.')}</p><Link to="/discover?type=short-drama"><Button>{t('Browse short drama templates')}</Button></Link></section>
      <section><ApartmentOutlined /><h2>{t('Professional workflows')}</h2><p>{t('Connect models and control each step on the canvas.')}</p><Button onClick={() => openFeature('/workflows/new')}>{t('Create Workflow')}</Button><Link to="/discover?type=workflow">{t('Workflow templates')}</Link></section>
    </div>
  </div>;
}
