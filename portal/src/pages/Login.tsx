import LanguageSwitcher from '../components/Layout/LanguageSwitcher';
import '../styles/portal-shell.css';
import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Input, message } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import tokens from '../theme/dark';
import { useAuthStore } from '../store/auth-store';
import { getAuthReturnPath } from '../utils/auth-redirect';
import SocialAuth from '../components/Auth/SocialAuth';
import BrandIcon from '../components/BrandIcon';

export default function Login() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, error } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const params = new URLSearchParams(location.search);
  const reason = params.get('error');
  const returnState = location.state ?? { from: params.get('returnTo') };
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => {
    useAuthStore.getState().setError(reason === 'email_conflict'
      ? 'An account already uses this email. Please sign in using its original method.'
      : reason === 'oauth_unavailable' ? 'Third-party sign-in is temporarily unavailable. Please use your email and password, or try again later.'
      : reason && reason !== 'oauth_rate_limited' ? 'Sign-in could not be completed. Please try again.' : null);
    const seconds = Number(new URLSearchParams(location.search).get('retryAfter'));
    const start = Date.now(); setNow(start);
    setRetryAt(reason === 'oauth_rate_limited' ? start + (Number.isInteger(seconds) && seconds > 0 ? Math.min(900, seconds) : 900) * 1000 : 0);
  }, [location.search]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => {
      const value = Date.now(); setNow(value);
      if (value >= retryAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      message.warning(t("Please fill in all fields"));
      return;
    }

    setLoading(true);
    try {
      await login(email.trim(), password);
      message.success(t("Login successful"));
      navigate(getAuthReturnPath(returnState), { replace: true });
    } catch (err) {
      // Error is handled by store
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: tokens.bg.primary,
    }}>
      <div className="portal-auth-language"><LanguageSwitcher /></div>
      {/* 左侧装饰区域 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: tokens.spacing.xxl,
        background: `linear-gradient(135deg, ${tokens.bg.secondary} 0%, ${tokens.bg.tertiary} 100%)`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* 装饰性背景 */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `radial-gradient(ellipse at 30% 50%, ${tokens.accent.primary}15 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          {/* Logo */}
          <div style={{
            width: 80,
            height: 80,
            margin: `0 auto ${tokens.spacing.xl}`,
            borderRadius: tokens.radius.xl,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: tokens.shadow.glowLg,
          }}>
            <BrandIcon size={80} />
          </div>

          <h1 style={{
            fontSize: tokens.font.size.xxl,
            fontWeight: tokens.font.weight.bold,
            color: tokens.text.primary,
            marginBottom: tokens.spacing.md,
          }}>
            Model Hub
          </h1>

          <p style={{
            fontSize: tokens.font.size.lg,
            color: tokens.text.secondary,
            maxWidth: 400,
            lineHeight: 1.6,
          }}>
            {t("Design, build, and deploy automated AI workflows with our visual canvas.")}</p>

          {/* 特性列表 */}
          <div style={{
            marginTop: tokens.spacing.xxl,
            textAlign: 'left',
            maxWidth: 360,
          }}>
            {[
              'Visual workflow editor with drag & drop',
              'Connect multiple AI models',
              'Real-time execution monitoring',
              'Team collaboration features',
            ].map((feature, index) => (
              <div key={index} style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.spacing.md,
                marginBottom: tokens.spacing.md,
              }}>
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: `${tokens.accent.primary}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <span style={{ color: tokens.accent.primary, fontSize: 12 }}>✓</span>
                </div>
                <span style={{ color: tokens.text.secondary, fontSize: tokens.font.size.base }}>
                  {feature}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div style={{
        width: 480,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: `${tokens.spacing.xxl} ${tokens.spacing.xxl}`,
      }}>
        <div style={{ maxWidth: 360, margin: '0 auto', width: '100%' }}>
          <h2 style={{
            fontSize: tokens.font.size.xxl,
            fontWeight: tokens.font.weight.semibold,
            color: tokens.text.primary,
            marginBottom: tokens.spacing.sm,
          }}>
            {t("Welcome back")}</h2>
          <p style={{
            fontSize: tokens.font.size.base,
            color: tokens.text.secondary,
            marginBottom: tokens.spacing.xl,
          }}>
            {t("Sign in to your account to continue")}</p>

          {/* 错误提示 */}
          {reason === 'oauth_rate_limited' && <Alert style={{ marginBottom: tokens.spacing.lg }} type="warning" showIcon
            message={t('Third-party sign-in requests are too frequent.')}
            description={retrySeconds > 0
              ? t('Please try again in {seconds} seconds, or sign in with your email and password.').replace('{seconds}', String(retrySeconds))
              : t('You can try third-party sign-in again, or sign in with your email and password.')} />}
          {error && (
            <div role="alert" style={{
              padding: tokens.spacing.md,
              marginBottom: tokens.spacing.lg,
              background: `${tokens.status.error}15`,
              border: `1px solid ${tokens.status.error}30`,
              borderRadius: tokens.radius.md,
              color: tokens.status.error,
              fontSize: tokens.font.size.sm,
            }}>
              {t(error)}
              {new URLSearchParams(location.search).get('error') === 'email_conflict' && (
                <div style={{ marginTop: tokens.spacing.sm }}>
                  <Link to="/login" state={{ from: '/profile' }}>{t('Sign in and go to account linking')}</Link>
                </div>
              )}
            </div>
          )}

          {/* 登录表单 */}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: tokens.spacing.lg }}>
              <label htmlFor="login-email" style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.secondary,
                fontWeight: tokens.font.weight.medium,
              }}>
                {t("Email")}</label>
              <Input
                id="login-email"
                prefix={<MailOutlined style={{ color: tokens.text.tertiary }} />}
                type="email"
                autoComplete="email"
                required
                placeholder={t("Enter your email")}
                value={email}
                onChange={(e) => { setEmail(e.target.value); useAuthStore.getState().setError(null); }}
                size="large"
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>

            <div style={{ marginBottom: tokens.spacing.lg }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: tokens.spacing.sm,
              }}>
                <label htmlFor="login-password" style={{
                  fontSize: tokens.font.size.sm,
                  color: tokens.text.secondary,
                  fontWeight: tokens.font.weight.medium,
                }}>
                  {t("Password")}</label>
                <Link to="/forgot-password" state={location.state} style={{
                  fontSize: tokens.font.size.sm,
                  color: tokens.accent.primary,
                }}>
                  {t("Forgot password?")}</Link>
              </div>
              <Input.Password
                id="login-password"
                prefix={<LockOutlined style={{ color: tokens.text.tertiary }} />}
                placeholder={t("Enter your password")}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => { setPassword(e.target.value); useAuthStore.getState().setError(null); }}
                size="large"
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>

            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={loading}
              style={{
                height: 44,
                background: tokens.accent.gradient,
                border: 'none',
                fontWeight: tokens.font.weight.medium,
              }}
            >
              {t("Sign in")}</Button>
          </form>

          <SocialAuth returnState={returnState} disabled={loading || retrySeconds > 0} />

          {/* 注册链接 */}
          <p style={{
            textAlign: 'center',
            color: tokens.text.secondary,
            fontSize: tokens.font.size.base,
          }}>
            {t("Don't have an account?")}{' '}
            <Link to="/register" state={returnState} style={{
              color: tokens.accent.primary,
              fontWeight: tokens.font.weight.medium,
            }}>
              {t("Sign up")}</Link>
          </p>
          <p style={{ textAlign: 'center' }}><Link to="/">{t("Continue browsing")}</Link></p>
        </div>
      </div>
    </div>
  );
}
