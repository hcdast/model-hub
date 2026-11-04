import { Component, type ReactNode } from 'react';
import { Alert, Button, Space } from 'antd';

/** A stale lazy chunk must leave a recovery action instead of an empty screen. */
export default class RouteErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const stale = /dynamically imported|Loading chunk|Importing a module/i.test(this.state.error.message);
    return <Alert type="error" showIcon message={stale ? '页面资源已更新或加载失败' : '页面暂时无法显示'}
      description={<Space direction="vertical"><span>请重新加载以获取最新页面。未保存的输入可能需要重新填写。</span>
        <Button onClick={() => window.location.reload()}>重新加载页面</Button></Space>} />;
  }
}
