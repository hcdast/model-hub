import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

/**
 * 403 权限不足页面
 * 当用户访问无权限的路由时，PermissionRoute 组件会重定向到此页面
 * 使用 Ant Design Result 组件展示友好的权限不足提示
 */
export default function ForbiddenPage() {
  const navigate = useNavigate();

  return (
    <Result
      status="403"
      title="403"
      subTitle="抱歉，您没有权限访问此页面。"
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      }
    />
  );
}
