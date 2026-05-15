import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, message, Space, Alert } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/auth';
import { BrandMark } from '../components/BrandMark';
import { COLOR_PRIMARY } from '../theme/antd-theme';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const isDevelopment = import.meta.env.VITE_NODE_ENV === 'development';

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res: any = await authApi.login(values.username, values.password);
      login(res.data.accessToken, values.username, res.data.roles || [], res.data.permissions || [], res.data.menus || []);
      message.success('登录成功');
      navigate('/');
    } catch {
      message.error('用户名或密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        padding: 24,
        background: 'linear-gradient(145deg, #0f172a 0%, #134e4a 42%, #1e1b4b 100%)',
      }}
    >
      <Card
        variant="borderless"
        style={{
          width: 420,
          maxWidth: '100%',
          borderRadius: 16,
          background: 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 16px 48px rgba(15, 23, 42, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.2)',
        }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%', textAlign: 'center' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <BrandMark size={44} />
            </div>
            <Typography.Title level={3} style={{ margin: '8px 0 0', color: '#0f172a', fontWeight: 700 }}>
              Model-Hub 管理后台
            </Typography.Title>
            <Typography.Text style={{ color: '#475569' }}>统一 AI 模型接入中台</Typography.Text>
          </div>
          {isDevelopment && (
            <Alert
              message="开发环境默认账号"
              description={
                <div>
                  <div>
                    用户名: <strong>admin</strong>
                  </div>
                  <div>
                    密码: <strong>changeme123</strong>
                  </div>
                </div>
              }
              type="info"
              showIcon
            />
          )}
          <Form onFinish={onFinish} size="large" style={{ textAlign: 'left' }}>
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined style={{ color: COLOR_PRIMARY }} />} placeholder="用户名" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined style={{ color: COLOR_PRIMARY }} />} placeholder="密码" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                登 录
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
