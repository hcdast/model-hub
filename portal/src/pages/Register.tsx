import LanguageSwitcher from '../components/Layout/LanguageSwitcher';
import '../styles/portal-shell.css';
import { useI18n } from '../i18n';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, Checkbox, message } from 'antd';
import { MailOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import tokens from '../theme/dark';
import { useAuthStore } from '../store/auth-store';
import { getAuthReturnPath } from '../utils/auth-redirect';
import EmailCodeInput from '../components/Auth/EmailCodeInput';
import SocialAuth from '../components/Auth/SocialAuth';
import BrandIcon from '../components/BrandIcon';

export default function Register() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { register, error } = useAuthStore();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { useAuthStore.getState().setError(null); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !email || !password || !confirmPassword || verificationCode.length !== 6) {
      message.warning(t("Please fill in all fields"));
      return;
    }

    if (username.trim().length < 3) {
      message.error('Username must be at least 3 characters');
      return;
    }

    if (password !== confirmPassword) {
      message.error('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      message.error('Password must be at least 8 characters');
      return;
    }

    if (new TextEncoder().encode(password).length > 72) {
      message.error('Password must be at most 72 UTF-8 bytes');
      return;
    }

    if (!agreeTerms) {
      message.warning('Please agree to the Terms of Service');
      return;
    }

    setLoading(true);
    try {
      await register(email.trim(), username.trim(), password, verificationCode, agreeTerms);
      message.success(t("Registration successful"));
      navigate(getAuthReturnPath(location.state), { replace: true });
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
          background: `radial-gradient(ellipse at 70% 50%, ${tokens.accent.secondary}15 0%, transparent 70%)`,
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
            {t('Join Model Hub')}
          </h1>

          <p style={{
            fontSize: tokens.font.size.lg,
            color: tokens.text.secondary,
            maxWidth: 400,
            lineHeight: 1.6,
          }}>
            {t("Create your account and start building powerful AI workflows today.")}</p>

          {/* 统计数据 */}
          <div style={{
            display: 'flex',
            gap: tokens.spacing.xxl,
            marginTop: tokens.spacing.xxl,
            justifyContent: 'center',
          }}>
            {[
              { value: '10K+', label: 'Active Users' },
              { value: '50K+', label: 'Workflows Created' },
              { value: '99.9%', label: 'Uptime' },
            ].map((stat, index) => (
              <div key={index} style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: tokens.font.size.xxl,
                  fontWeight: tokens.font.weight.bold,
                  color: tokens.accent.primary,
                  marginBottom: tokens.spacing.xs,
                }}>
                  {stat.value}
                </div>
                <div style={{
                  fontSize: tokens.font.size.sm,
                  color: tokens.text.tertiary,
                }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧注册表单 */}
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
            {t("Create an account")}</h2>
          <p style={{
            fontSize: tokens.font.size.base,
            color: tokens.text.secondary,
            marginBottom: tokens.spacing.xl,
          }}>
            {t("Get started with your free account")}</p>

          {/* 错误提示 */}
          {error && (
            <div style={{
              padding: tokens.spacing.md,
              marginBottom: tokens.spacing.lg,
              background: `${tokens.status.error}15`,
              border: `1px solid ${tokens.status.error}30`,
              borderRadius: tokens.radius.md,
              color: tokens.status.error,
              fontSize: tokens.font.size.sm,
            }}>
              {error}
            </div>
          )}

          {/* 注册表单 */}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: tokens.spacing.lg }}>
              <label style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.secondary,
                fontWeight: tokens.font.weight.medium,
              }}>
                {t("Username")}</label>
              <Input
                prefix={<UserOutlined style={{ color: tokens.text.tertiary }} />}
                placeholder={t("Choose a username")}
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                maxLength={30}
                size="large"
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>

            <div style={{ marginBottom: tokens.spacing.lg }}>
              <label style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.secondary,
                fontWeight: tokens.font.weight.medium,
              }}>
                {t("Email")}</label>
              <Input
                prefix={<MailOutlined style={{ color: tokens.text.tertiary }} />}
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                placeholder={t("Enter your email")}
                value={email}
                onChange={(e) => { setEmail(e.target.value); setVerificationCode(''); }}
                size="large"
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>

            <EmailCodeInput email={email} purpose="register" value={verificationCode} onChange={setVerificationCode} />

            <div style={{ marginBottom: tokens.spacing.lg }}>
              <label style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.secondary,
                fontWeight: tokens.font.weight.medium,
              }}>
                {t("Password")}</label>
              <Input.Password
                prefix={<LockOutlined style={{ color: tokens.text.tertiary }} />}
                placeholder={t("Create a password (min 8 characters)")}
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                size="large"
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>

            <div style={{ marginBottom: tokens.spacing.lg }}>
              <label style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.secondary,
                fontWeight: tokens.font.weight.medium,
              }}>
                {t("Confirm Password")}</label>
              <Input.Password
                prefix={<LockOutlined style={{ color: tokens.text.tertiary }} />}
                placeholder={t("Confirm your password")}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                size="large"
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>

            <div style={{ marginBottom: tokens.spacing.xl }}>
              <Checkbox
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                style={{ color: tokens.text.secondary }}
              >
                {t("I agree to the")}{' '}
                <Link to="/terms" style={{ color: tokens.accent.primary }}>
                  {t("Terms of Service")}</Link>
                {' '}{t("and")}{' '}
                <Link to="/privacy" style={{ color: tokens.accent.primary }}>
                  {t("Privacy Policy")}</Link>
              </Checkbox>
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
              {t("Create account")}</Button>
          </form>

          <SocialAuth returnState={location.state} disabled={loading} />

          {/* 登录链接 */}
          <p style={{
            textAlign: 'center',
            marginTop: tokens.spacing.xl,
            color: tokens.text.secondary,
            fontSize: tokens.font.size.base,
          }}>
            {t("Already have an account?")}{' '}
            <Link to="/login" state={location.state} style={{
              color: tokens.accent.primary,
              fontWeight: tokens.font.weight.medium,
            }}>
              {t("Sign in")}</Link>
          </p>
          <p style={{ textAlign: 'center' }}><Link to="/">{t("Continue browsing")}</Link></p>
        </div>
      </div>
    </div>
  );
}
