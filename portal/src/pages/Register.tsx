import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input, Checkbox, message } from 'antd';
import { MailOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import tokens from '../theme/dark';
import { useAuthStore } from '../store/auth-store';

export default function Register() {
  const navigate = useNavigate();
  const { register, error } = useAuthStore();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !email || !password || !confirmPassword) {
      message.warning('Please fill in all fields');
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

    if (!agreeTerms) {
      message.warning('Please agree to the Terms of Service');
      return;
    }

    setLoading(true);
    try {
      await register(email, username, password);
      message.success('Registration successful');
      navigate('/');
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
            background: tokens.accent.gradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: tokens.shadow.glowLg,
          }}>
            <span style={{ fontSize: 36, fontWeight: 700, color: '#fff' }}>W</span>
          </div>

          <h1 style={{
            fontSize: tokens.font.size.xxl,
            fontWeight: tokens.font.weight.bold,
            color: tokens.text.primary,
            marginBottom: tokens.spacing.md,
          }}>
            加入 Model Hub
          </h1>

          <p style={{
            fontSize: tokens.font.size.lg,
            color: tokens.text.secondary,
            maxWidth: 400,
            lineHeight: 1.6,
          }}>
            Create your account and start building powerful AI workflows today.
          </p>

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
            Create an account
          </h2>
          <p style={{
            fontSize: tokens.font.size.base,
            color: tokens.text.secondary,
            marginBottom: tokens.spacing.xl,
          }}>
            Get started with your free account
          </p>

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
                Username
              </label>
              <Input
                prefix={<UserOutlined style={{ color: tokens.text.tertiary }} />}
                placeholder="Choose a username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
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
                Email
              </label>
              <Input
                prefix={<MailOutlined style={{ color: tokens.text.tertiary }} />}
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                Password
              </label>
              <Input.Password
                prefix={<LockOutlined style={{ color: tokens.text.tertiary }} />}
                placeholder="Create a password (min 8 characters)"
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
                Confirm Password
              </label>
              <Input.Password
                prefix={<LockOutlined style={{ color: tokens.text.tertiary }} />}
                placeholder="Confirm your password"
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
                I agree to the{' '}
                <Link to="/terms" style={{ color: tokens.accent.primary }}>
                  Terms of Service
                </Link>
                {' '}and{' '}
                <Link to="/privacy" style={{ color: tokens.accent.primary }}>
                  Privacy Policy
                </Link>
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
              Create account
            </Button>
          </form>

          {/* 登录链接 */}
          <p style={{
            textAlign: 'center',
            marginTop: tokens.spacing.xl,
            color: tokens.text.secondary,
            fontSize: tokens.font.size.base,
          }}>
            Already have an account?{' '}
            <Link to="/login" style={{
              color: tokens.accent.primary,
              fontWeight: tokens.font.weight.medium,
            }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
