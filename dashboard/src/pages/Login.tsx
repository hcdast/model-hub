import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, message, Space, Alert } from 'antd';
import { UserOutlined, LockOutlined, ApiOutlined } from '@ant-design/icons';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/auth';

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
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <Card style={{ width: 400, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
        <Space direction="vertical" size="large" style={{ width: '100%', textAlign: 'center' }}>
          <div>
            <ApiOutlined style={{ fontSize: 48, color: '#1677ff' }} />
            <Typography.Title level={3} style={{ margin: '12px 0 0' }}>Model-Hub 管理后台</Typography.Title>
            <Typography.Text type="secondary">统一 AI 模型接入中台</Typography.Text>
          </div>
          {isDevelopment && (
            <Alert
              message="开发环境默认账号"
              description={
                <div>
                  <div>用户名: <strong>admin</strong></div>
                  <div>密码: <strong>changeme123</strong></div>
                </div>
              }
              type="info"
              showIcon
            />
          )}
          <Form onFinish={onFinish} size="large" style={{ textAlign: 'left' }}>
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>登 录</Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
