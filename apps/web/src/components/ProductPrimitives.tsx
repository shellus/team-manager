import type { ReactNode } from 'react';
import { Alert, Button, Checkbox, Empty, Skeleton, Space, Typography } from 'antd';
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

export type TriStateFilterValue = 'true' | 'false' | undefined;

export function TriStateCheckboxFilter({ label, value, onChange }: { label: string; value: TriStateFilterValue; onChange: (value: TriStateFilterValue) => void }) {
  const options = [
    { value: 'true', label: '是' },
    { value: 'false', label: '否' },
  ] as const;
  return <div className="tri-state-checkbox-filter" role="group" aria-label={`${label}筛选，均不选表示所有`}><Typography.Text>{label}</Typography.Text><Space size={8}>{options.map((option) => <Checkbox key={option.value} checked={value === option.value} onChange={() => onChange(value === option.value ? undefined : option.value)}>{option.label}</Checkbox>)}</Space></div>;
}

export function formatTime(value?: string | number | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
}
