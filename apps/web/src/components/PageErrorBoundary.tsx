import { Button, Result } from 'antd';
import { Component, type ReactNode } from 'react';

interface PageErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
}

interface PageErrorBoundaryState {
  error?: Error;
}

export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  state: PageErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previousProps: PageErrorBoundaryProps) {
    if (shouldResetPageError(previousProps.resetKey, this.props.resetKey, this.state.error)) {
      this.setState({ error: undefined });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Result
        status="error"
        title="页面加载失败"
        subTitle={this.state.error.message || '页面数据异常，请刷新后重试'}
        extra={(
          <Button type="primary" onClick={() => window.location.reload()}>
            重新加载页面
          </Button>
        )}
      />
    );
  }
}

export function shouldResetPageError(
  previousResetKey: string | undefined,
  nextResetKey: string | undefined,
  error: Error | undefined
): boolean {
  return Boolean(error && previousResetKey !== nextResetKey);
}
