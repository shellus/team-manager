import type { ReactNode } from 'react';
import { Alert, Button, Empty, Input, Skeleton, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <div className="page-header"><div><Typography.Title level={2}>{title}</Typography.Title>{description && <Typography.Text type="secondary">{description}</Typography.Text>}</div>{actions && <Space wrap>{actions}</Space>}</div>;
}

export function LoadBoundary({ loading, error, empty, onRetry, children }: { loading: boolean; error?: string; empty?: boolean; onRetry?: () => void; children: ReactNode }) {
  if (loading) return <Skeleton active paragraph={{ rows: 7 }} />;
  if (error) return <Alert type="error" showIcon message="加载失败" description={error} action={onRetry && <Button icon={<ReloadOutlined />} onClick={onRetry}>重新加载</Button>} />;
  if (empty) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  return <>{children}</>;
}

export function JsonViewer({ value, title = '原始 JSON' }: { value: unknown; title?: string }) {
  if (value instanceof Blob) return <details className="raw-debug"><summary>{title}</summary><Typography.Text type="secondary">二进制原文，大小 {value.size} 字节。请使用下载按钮读取完整内容。</Typography.Text></details>;
  const text = JSON.stringify(value ?? {}, null, 2);
  return <details className="raw-debug"><summary>{title}</summary><Space direction="vertical" className="panel-stack"><Input.TextArea value={text} readOnly autoSize={{ minRows: 6, maxRows: 28 }} className="raw-json"/><Button onClick={() => void navigator.clipboard.writeText(text)}>复制完整 JSON</Button></Space></details>;
}

export function formatTime(value?: string | number | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}
