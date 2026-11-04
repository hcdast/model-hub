import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input, Avatar, message, Card, Statistic, Alert, Tag } from 'antd';
import {
  UserOutlined,
  MailOutlined,
  EditOutlined,
  SaveOutlined,
  LockOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import tokens from '../theme/dark';
import { useAuthStore, getApiErrorMessage } from '../store/auth-store';
import { authApi } from '../services/auth-api';
import { useI18n } from '../i18n';

export default function Profile() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const { user, updateProfile, isLoading } = useAuthStore();
  const [providers, setProviders] = useState<{ google: boolean; github: boolean } | null>(null);
  const [providerError, setProviderError] = useState(false);
  const [linking, setLinking] = useState<'google' | 'github' | null>(null);
  useEffect(() => {
    let active = true;
    authApi.providers().then(response => {
      if (active) setProviders((response as unknown as { data: { google: boolean; github: boolean } }).data);
    }).catch(() => { if (active) setProviderError(true); });
    return () => { active = false; };
  }, []);

  const handleLink = async (provider: 'google' | 'github') => {
    setLinking(provider);
    try {
      const response = await authApi.linkOAuth(provider) as unknown as { data: { url: string } };
      window.location.assign(response.data.url);
    } catch (error) {
      message.error(t(getApiErrorMessage(error, 'Unable to start account linking. Please try again.')));
      setLinking(null);
    }
  };

  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(user?.username || '');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSaveProfile = async () => {
    if (!username.trim()) {
      message.warning('Username cannot be empty');
      return;
    }

    try {
      await updateProfile({ username });
      message.success('Profile updated');
      setEditing(false);
    } catch (err) {
      // Error handled by store
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      message.warning('Please fill in all fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      message.error('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      message.error('Password must be at least 8 characters');
      return;
    }

    try {
      await authApi.changePassword({ oldPassword, newPassword });
      message.success('Password changed successfully');
      setShowPasswordForm(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      message.error(err.response?.data?.message || 'Failed to change password');
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div style={{
      maxWidth: 800,
      margin: '0 auto',
      padding: tokens.spacing.xl,
    }}>
      <h1 style={{
        fontSize: tokens.font.size.xxl,
        fontWeight: tokens.font.weight.semibold,
        color: tokens.text.primary,
        marginBottom: tokens.spacing.xl,
      }}>
        Profile
      </h1>

      {/* 用户信息卡片 */}
      <Card
        style={{
          background: tokens.bg.tertiary,
          borderColor: tokens.border.default,
          marginBottom: tokens.spacing.xl,
        }}
      >
        <div style={{
          display: 'flex',
          gap: tokens.spacing.xl,
          alignItems: 'flex-start',
        }}>
          {/* 头像 */}
          <div style={{ textAlign: 'center' }}>
            <Avatar
              size={96}
              src={user.avatar}
              icon={<UserOutlined />}
              style={{
                background: tokens.accent.primary,
                marginBottom: tokens.spacing.md,
              }}
            />
            <div>
              <Button
                size="small"
                style={{
                  background: tokens.bg.elevated,
                  borderColor: tokens.border.default,
                  color: tokens.text.secondary,
                }}
              >
                Change Avatar
              </Button>
            </div>
          </div>

          {/* 信息 */}
          <div style={{ flex: 1 }}>
            {/* 用户名 */}
            <div style={{ marginBottom: tokens.spacing.lg }}>
              <label style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.tertiary,
              }}>
                Username
              </label>
              {editing ? (
                <div style={{ display: 'flex', gap: tokens.spacing.sm }}>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={{
                      background: tokens.bg.secondary,
                      borderColor: tokens.border.default,
                    }}
                  />
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={handleSaveProfile}
                    loading={isLoading}
                  >
                    Save
                  </Button>
                  <Button onClick={() => {
                    setEditing(false);
                    setUsername(user.username);
                  }}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.spacing.md,
                }}>
                  <span style={{
                    fontSize: tokens.font.size.lg,
                    color: tokens.text.primary,
                    fontWeight: tokens.font.weight.medium,
                  }}>
                    {user.username}
                  </span>
                  <Button
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => setEditing(true)}
                    style={{ color: tokens.text.tertiary }}
                  />
                </div>
              )}
            </div>

            {/* 邮箱 */}
            <div style={{ marginBottom: tokens.spacing.lg }}>
              <label style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.tertiary,
              }}>
                Email
              </label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: tokens.spacing.sm,
              }}>
                <MailOutlined style={{ color: tokens.text.tertiary }} />
                <span style={{
                  fontSize: tokens.font.size.base,
                  color: tokens.text.primary,
                }}>
                  {user.email}
                </span>
              </div>
            </div>

            {/* 角色 */}
            <div>
              <label style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.tertiary,
              }}>
                Role
              </label>
              <span style={{
                padding: `${tokens.spacing.xs} ${tokens.spacing.md}`,
                background: `${tokens.accent.primary}20`,
                color: tokens.accent.primary,
                borderRadius: tokens.radius.sm,
                fontSize: tokens.font.size.sm,
              }}>
                {user.role}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card title={t('Sign-in methods')} style={{ background: tokens.bg.tertiary, borderColor: tokens.border.default, marginBottom: tokens.spacing.xl }}>
        {params.get('oauth') === 'linked' && <Alert role="status" type="success" showIcon message={t('Account linked. You can now sign in with this provider.')} style={{ marginBottom: tokens.spacing.md }} />}
        {params.get('oauth') === 'link_failed' && <Alert type="error" showIcon message={t('Account linking failed. Use the same email and ensure the provider is not linked to another account, then retry.')} style={{ marginBottom: tokens.spacing.md }} />}
        <p style={{ color: tokens.text.secondary }}>{t('Link a provider with the same email. Your existing workflows and account stay together.')}</p>
        {providerError && <Alert type="error" message={t('Unable to load sign-in options.')} style={{ marginBottom: tokens.spacing.md }} />}
        {(['google', 'github'] as const).map(provider => (
          <div key={provider} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `${tokens.spacing.md} 0`, borderBottom: `1px solid ${tokens.border.default}` }}>
            <span style={{ color: tokens.text.primary }}>{provider === 'google' ? 'Google' : 'GitHub'}</span>
            {user.authMethods?.[provider] ? <Tag color="green">{t('Linked')}</Tag> : (
              <Button onClick={() => handleLink(provider)} disabled={!providers?.[provider] || !!linking} loading={linking === provider}>
                {t('Link account')}
              </Button>
            )}
          </div>
        ))}
      </Card>

      {/* 统计数据 */}
      <Card
        title="Usage Statistics"
        style={{
          background: tokens.bg.tertiary,
          borderColor: tokens.border.default,
          marginBottom: tokens.spacing.xl,
        }}
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: tokens.spacing.xl,
        }}>
          <Statistic
            title="Total Workflows"
            value={user.usage.totalWorkflows}
            prefix={<AppstoreOutlined />}
            valueStyle={{ color: tokens.accent.primary }}
          />
          <Statistic
            title="Total Runs"
            value={user.usage.totalRuns}
            prefix={<ThunderboltOutlined />}
            valueStyle={{ color: tokens.accent.secondary }}
          />
          <Statistic
            title="Total Tokens"
            value={user.usage.totalTokens}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ color: tokens.status.success }}
          />
        </div>
      </Card>

      {/* 安全设置 */}
      <Card
        title="Security"
        style={{
          background: tokens.bg.tertiary,
          borderColor: tokens.border.default,
        }}
      >
        {user.authMethods?.password === false ? (
          <p style={{ color: tokens.text.secondary }}>You signed in with {user.authMethods.google ? 'Google' : 'GitHub'}. Manage your password with that provider.</p>
        ) : showPasswordForm ? (
          <div style={{ maxWidth: 400 }}>
            <div style={{ marginBottom: tokens.spacing.lg }}>
              <label style={{
                display: 'block',
                marginBottom: tokens.spacing.sm,
                fontSize: tokens.font.size.sm,
                color: tokens.text.secondary,
              }}>
                Current Password
              </label>
              <Input.Password
                prefix={<LockOutlined style={{ color: tokens.text.tertiary }} />}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                style={{
                  background: tokens.bg.secondary,
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
              }}>
                New Password
              </label>
              <Input.Password
                prefix={<LockOutlined style={{ color: tokens.text.tertiary }} />}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={{
                  background: tokens.bg.secondary,
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
              }}>
                Confirm New Password
              </label>
              <Input.Password
                prefix={<LockOutlined style={{ color: tokens.text.tertiary }} />}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{
                  background: tokens.bg.secondary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: tokens.spacing.sm }}>
              <Button
                type="primary"
                onClick={handleChangePassword}
                loading={isLoading}
              >
                Change Password
              </Button>
              <Button onClick={() => {
                setShowPasswordForm(false);
                setOldPassword('');
                setNewPassword('');
                setConfirmPassword('');
              }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{
                fontSize: tokens.font.size.base,
                color: tokens.text.primary,
                fontWeight: tokens.font.weight.medium,
                marginBottom: tokens.spacing.xs,
              }}>
                Password
              </div>
              <div style={{
                fontSize: tokens.font.size.sm,
                color: tokens.text.tertiary,
              }}>
                Last changed: Unknown
              </div>
            </div>
            <Button
              icon={<LockOutlined />}
              onClick={() => setShowPasswordForm(true)}
              style={{
                background: tokens.bg.elevated,
                borderColor: tokens.border.default,
                color: tokens.text.primary,
              }}
            >
              Change Password
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
