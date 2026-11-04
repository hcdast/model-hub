import { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Result, Spin } from 'antd';
import tokens from '../../theme/dark';
import { useAuthStore } from '../../store/auth-store';
import { useI18n } from '../../i18n';

interface ProtectedRouteProps {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isInitialized } = useAuthStore();

  // 检查中
  if (!isInitialized) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: tokens.bg.primary,
      }}>
        <Spin size="large" />
      </div>
    );
  }

  // 直接访问个人功能时提示登录，仍可返回公开页面继续浏览。
  if (!isAuthenticated) {
    return (
      <Result
        status="info"
        title={t('Sign in to continue')}
        subTitle={t('Please sign in to use this feature. You can browse the portal without an account.')}
        extra={[
          <Button key="login" type="primary" onClick={() => navigate('/login', { state: { from: location } })}>{t('Sign in')}</Button>,
          <Button key="browse" onClick={() => navigate('/')}>{t('Keep browsing')}</Button>,
        ]}
      />
    );
  }

  return <>{children}</>;
}
