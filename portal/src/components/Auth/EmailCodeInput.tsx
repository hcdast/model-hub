import { useEffect, useState } from 'react';
import { Button, Input, message } from 'antd';
import { authApi } from '../../services/auth-api';
import { getApiErrorMessage } from '../../store/auth-store';

export default function EmailCodeInput({ email, purpose, value, onChange }: {
  email: string; purpose: 'register' | 'reset-password'; value: string; onChange: (value: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const send = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      message.warning('Enter a valid email address first'); return;
    }
    setSending(true);
    try {
      await authApi.sendEmailCode({ email: email.trim(), purpose });
      setRetryAt(Date.now() + 60000);
      message.success(purpose === 'register' ? 'Verification code sent. Check your inbox.' : 'If this email has a password account, a reset code has been sent.');
    } catch (error) { message.error(getApiErrorMessage(error, 'Unable to send verification code')); }
    finally { setSending(false); }
  };
  return <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
    <Input aria-label="Email verification code" placeholder="6-digit email code" autoComplete="one-time-code"
      inputMode="numeric" value={value} maxLength={6} required pattern="[0-9]{6}"
      onChange={event => onChange(event.target.value.replace(/\D/g, ''))} size="large" />
    <Button size="large" htmlType="button" loading={sending} disabled={seconds > 0} onClick={() => void send()}>
      {seconds > 0 ? `${seconds}s` : 'Send code'}
    </Button>
  </div>;
}
