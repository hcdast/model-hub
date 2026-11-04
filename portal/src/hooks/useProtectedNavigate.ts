import { Modal } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth-store';
import { useI18n } from '../i18n';

/** Ask for sign-in only when a visitor opens a feature that needs an account. */
export function useProtectedNavigate() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [modal, contextHolder] = Modal.useModal();

  const openFeature = (to: string) => {
    if (useAuthStore.getState().isAuthenticated) {
      navigate(to);
      return;
    }

    modal.confirm({
      title: t('Sign in to continue'),
      content: t('Please sign in to use this feature. You can keep browsing without an account.'),
      okText: t('Sign in'),
      cancelText: t('Keep browsing'),
      onOk: () => navigate('/login', { state: { from: to } }),
    });
  };
  return { openFeature, loginPrompt: contextHolder };
}
