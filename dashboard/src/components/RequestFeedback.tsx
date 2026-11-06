import { Alert, Button } from 'antd';

export default function RequestFeedback({ error, hasData, retry }: { error?: Error; hasData: boolean; retry: () => void }) {
  if (!error) return null;
  return <Alert type="error" showIcon style={{ marginBottom: 12 }} message={hasData ? '刷新失败，当前显示上次成功加载的数据' : '数据加载失败，请重试'} description={error.message} action={<Button onClick={retry}>重试</Button>} />;
}
