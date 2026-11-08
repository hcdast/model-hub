import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { dramaApi } from '../services/drama-api';
import { getApiErrorMessage, useAuthStore } from '../store/auth-store';
import { useProtectedNavigate } from './useProtectedNavigate';
import { useI18n } from '../i18n';
import { templateEvent } from '../services/creation-events';

export function useDramaTemplateCopy() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { openFeature, loginPrompt } = useProtectedNavigate();
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copyTemplate = async (id: string) => {
    templateEvent('create_click', 'short-drama', id);
    if (!useAuthStore.getState().isAuthenticated) { openFeature(`/drama-templates/${encodeURIComponent(id)}`); return; }
    if (pending.current) return;
    pending.current = true; setCopyingId(id);
    try {
      const project = await dramaApi.fromTemplate(id);
      if (!mounted.current || !useAuthStore.getState().isAuthenticated) return;
      message.success(t('Project created. Review your story before generating.'));
      navigate(`/short-dramas/${encodeURIComponent(project.id)}`);
    } catch (error) {
      if (mounted.current) message.error(getApiErrorMessage(error, t('Unable to create project. Please try again.')));
    } finally { pending.current = false; if (mounted.current) setCopyingId(null); }
  };
  return { copyTemplate, copyingId, loginPrompt };
}
