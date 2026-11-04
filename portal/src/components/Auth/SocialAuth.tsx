import { useEffect, useState } from 'react';
import { Alert, Button, Tooltip } from 'antd';
import { GithubOutlined, GoogleOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { authApi } from '../../services/auth-api';
import { getAuthReturnPath } from '../../utils/auth-redirect';
import tokens from '../../theme/dark';
import { useI18n } from '../../i18n';

export default function SocialAuth({ returnState, disabled = false }: { returnState: unknown; disabled?: boolean }) {
  const { t } = useI18n();
  const [providers, setProviders] = useState({ google: false, github: false });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let active = true;
    setStatus('loading');
    authApi.providers().then((result: unknown) => {
      const body = result as { code?: number; data?: { google?: unknown; github?: unknown } } | null;
      if (body?.code !== 0 || typeof body.data?.google !== 'boolean' || typeof body.data.github !== 'boolean') throw new Error('Invalid sign-in options');
      if (active) { setProviders({ google: body.data.google, github: body.data.github }); setStatus('ready'); }
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [attempt]);
  const start = (provider: 'google' | 'github') => {
    if (disabled || starting || status !== 'ready' || !providers[provider]) return;
    setStarting(true);
    window.location.assign(`/api/v1/auth/oauth/${provider}?returnTo=${encodeURIComponent(getAuthReturnPath(returnState))}`);
  };
  return <div style={{ margin: '24px 0' }}>
    <p style={{ color: tokens.text.tertiary, textAlign: 'center' }}>{t('Or continue with')}</p>
    <div style={{ display: 'flex', gap: 12 }}>
      {(['github', 'google'] as const).map(provider => <Tooltip key={provider} title={status === 'loading' ? t('Loading sign-in options...') : status === 'error' ? t('Unable to load sign-in options.') : !providers[provider] ? t('This sign-in method is not enabled for this environment.') : undefined}>
        <Button block size="large" disabled={disabled || starting || status !== 'ready' || !providers[provider]}
          icon={provider === 'github' ? <GithubOutlined /> : <GoogleOutlined />}
          onClick={() => start(provider)}>{provider === 'github' ? 'GitHub' : 'Google'}</Button>
      </Tooltip>)}
    </div>
    {status === 'loading' && <p role="status" style={{ color: tokens.text.tertiary, fontSize: 12 }}>{t('Loading sign-in options...')}</p>}
    {status === 'error' && <Alert style={{ marginTop: 12 }} type="error" message={t('Unable to load sign-in options.')}
      action={<Button size="small" disabled={disabled || starting} onClick={() => setAttempt(value => value + 1)}>{t('Retry')}</Button>} />}
    {status === 'ready' && !providers.google && !providers.github && <p role="status" style={{ color: tokens.text.tertiary, fontSize: 12, marginTop: 12 }}>{t('Third-party sign-in is not enabled for this environment. You can sign in with your email and password.')}</p>}
    <p style={{ color: tokens.text.tertiary, fontSize: 12, marginTop: 12 }}>
      {t('By continuing, you agree to the')} <Link to="/terms">{t('Terms of Service')}</Link> {t('and')} <Link to="/privacy">{t('Privacy Policy')}</Link>.
    </p>
  </div>;
}
