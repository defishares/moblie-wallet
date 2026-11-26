import React from 'react';
import { reportClientError } from '../services/errorReporter';

interface State { failed: boolean }
export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(error: unknown): void { reportClientError(error, 'react-render'); }
  render() { return this.state.failed ? <main className="error-screen"><h1>页面暂时无法显示</h1><p>请刷新页面重试；当前标签页内存中的登录密钥不会被保存到本地。</p><button className="primary-button" type="button" onClick={() => window.location.reload()}>刷新页面</button></main> : this.props.children; }
}
