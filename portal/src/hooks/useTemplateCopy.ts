import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { message } from 'antd';
import { templateApi } from '../services/workflow-api';
import { useAuthStore } from '../store/auth-store';
import { useProtectedNavigate } from './useProtectedNavigate';
import { useI18n } from '../i18n';
import { templateEvent } from '../services/creation-events';

export function useTemplateCopy() {
  const navigate = useNavigate();
  const { openFeature, loginPrompt } = useProtectedNavigate();
  const { t } = useI18n();
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const copyTemplate = async (id: string) => {
    templateEvent('create_click', 'workflow', id);
    if (!useAuthStore.getState().isAuthenticated) { openFeature(`/templates/${encodeURIComponent(id)}`); return; }
    if (pending.current) return;
    pending.current = true; setCopyingId(id);
    try {
      const response = await templateApi.createFromTemplate(id);
      if (!mounted.current || !useAuthStore.getState().isAuthenticated) return;
      const workflowId = response.data._id || response.data.id;
      if (!workflowId) throw new Error(t('Unable to copy this template. Please try again.'));
      message.success(t('Template copied. Add your inputs and run your workflow.'));
      navigate(`/workflows/${encodeURIComponent(workflowId)}`);
    } catch (error) {
      if (!mounted.current) return;
      const detail = isAxiosError<{ message?: string | string[] }>(error) ? error.response?.data?.message : undefined;
      message.error(Array.isArray(detail) ? detail.join('；') : detail || t('Unable to copy this template. Please try again.'));
    } finally { pending.current = false; if (mounted.current) setCopyingId(null); }
  };
  return { copyTemplate, copyingId, loginPrompt };
}
