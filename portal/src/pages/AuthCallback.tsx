import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '../store/auth-store';
import { getAuthReturnPath } from '../utils/auth-redirect';

export default function AuthCallback() {
  const { isInitialized, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = getAuthReturnPath({ from: params.get('returnTo') });
  useEffect(() => {
    if (isInitialized) navigate(isAuthenticated ? returnTo : '/login?error=session_failed', { replace: true });
  }, [isInitialized, isAuthenticated, returnTo, navigate]);
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin size="large" tip="Completing sign-in…" /></div>;
}
