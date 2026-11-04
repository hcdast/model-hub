import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, message } from 'antd';
import EmailCodeInput from '../components/Auth/EmailCodeInput';
import { authApi } from '../services/auth-api';
import { getApiErrorMessage } from '../store/auth-store';
import tokens from '../theme/dark';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) { message.error('Passwords do not match'); return; }
    if (new TextEncoder().encode(password).length > 72) { message.error('Password must be at most 72 UTF-8 bytes'); return; }
    setLoading(true);
    try {
      await authApi.resetPassword({ email, password, verificationCode: code });
      message.success('Password reset. Please sign in with your new password.');
      navigate('/login', { replace: true, state: location.state });
    } catch (error) { message.error(getApiErrorMessage(error, 'Unable to reset password')); }
    finally { setLoading(false); }
  };
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: tokens.bg.primary, padding: 24 }}>
    <div style={{ maxWidth: 400, width: '100%' }}>
      <h1>Reset your password</h1>
      <p style={{ color: tokens.text.secondary }}>Enter the email used for your password account. For Google or GitHub accounts, use the original sign-in method.</p>
      <form onSubmit={event => void submit(event)} style={{ display: 'grid', gap: 16 }}>
        <Input type="email" aria-label="Email" autoComplete="email" placeholder="Email" required maxLength={254} size="large"
          value={email} onChange={event => { setEmail(event.target.value); setCode(''); }} />
        <EmailCodeInput email={email} purpose="reset-password" value={code} onChange={setCode} />
        <Input.Password aria-label="New password" autoComplete="new-password" placeholder="New password (min 8 characters)"
          required minLength={8} value={password} onChange={event => setPassword(event.target.value)} size="large" />
        <Input.Password aria-label="Confirm new password" autoComplete="new-password" placeholder="Confirm new password"
          required value={confirmation} onChange={event => setConfirmation(event.target.value)} size="large" />
        <Button type="primary" htmlType="submit" size="large" loading={loading}>Reset password</Button>
      </form>
      <p style={{ marginTop: 24 }}><Link to="/login" state={location.state}>Back to sign in</Link></p>
    </div>
  </div>;
}
