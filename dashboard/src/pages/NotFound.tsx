import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="请从左侧菜单选择功能，或返回总览。"
      extra={<Button type="primary" onClick={() => navigate('/')}>返回总览</Button>}
    />
  );
}
