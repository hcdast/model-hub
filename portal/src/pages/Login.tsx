import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input, Checkbox, message } from 'antd';
import { MailOutlined, LockOutlined, GithubOutlined, GoogleOutlined } from '@ant-design/icons';
import tokens from '../theme/dark';
import { useAuthStore } from '../store/auth-store';

export default function Login() {
  const navigate = useNavigate();
  const { login, error } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      message.warning('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
      message.success('Login successful');
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
            Model Hub
          </h1>

          <p style={{
            fontSize: tokens.font.size.lg,
            color: tokens.text.secondary,
            maxWidth: 400,
            lineHeight: 1.6,
          }}>
            Design, build, and deploy automated AI workflows with our visual canvas.
          </p>

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
            Welcome back
          </h2>
          <p style={{
            fontSize: tokens.font.size.base,
            color: tokens.text.secondary,
            marginBottom: tokens.spacing.xl,
          }}>
            Sign in to your account to continue
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

          {/* 登录表单 */}
          <form onSubmit={handleSubmit}>
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
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: tokens.spacing.sm,
              }}>
                <label style={{
                  fontSize: tokens.font.size.sm,
                  color: tokens.text.secondary,
                  fontWeight: tokens.font.weight.medium,
                }}>
                  Password
                </label>
                <Link to="/forgot-password" style={{
                  fontSize: tokens.font.size.sm,
                  color: tokens.accent.primary,
                }}>
                  Forgot password?
                </Link>
              </div>
              <Input.Password
                prefix={<LockOutlined style={{ color: tokens.text.tertiary }} />}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                size="large"
                style={{
                  background: tokens.bg.tertiary,
                  borderColor: tokens.border.default,
                }}
              />
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: tokens.spacing.xl,
            }}>
              <Checkbox
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ color: tokens.text.secondary }}
              >
                Remember me
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
              Sign in
            </Button>
          </form>

          {/* 分割线 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.spacing.md,
            margin: `${tokens.spacing.xl} 0`,
          }}>
            <div style={{ flex: 1, height: 1, background: tokens.border.default }} />
            <span style={{ color: tokens.text.tertiary, fontSize: tokens.font.size.sm }}>
              Or continue with
            </span>
            <div style={{ flex: 1, height: 1, background: tokens.border.default }} />
          </div>

          {/* 社交登录按钮 */}
          <div style={{
            display: 'flex',
            gap: tokens.spacing.md,
            marginBottom: tokens.spacing.xl,
          }}>
            <Button
              block
              size="large"
              icon={<GithubOutlined />}
              style={{
                background: tokens.bg.tertiary,
                borderColor: tokens.border.default,
                color: tokens.text.primary,
              }}
            >
              GitHub
            </Button>
            <Button
              block
              size="large"
              icon={<GoogleOutlined />}
              style={{
                background: tokens.bg.tertiary,
                borderColor: tokens.border.default,
                color: tokens.text.primary,
              }}
            >
              Google
            </Button>
          </div>

          {/* 注册链接 */}
          <p style={{
            textAlign: 'center',
            color: tokens.text.secondary,
            fontSize: tokens.font.size.base,
          }}>
            Don't have an account?{' '}
            <Link to="/register" style={{
              color: tokens.accent.primary,
              fontWeight: tokens.font.weight.medium,
            }}>
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
