import type { SubaccountAuthLog } from '@team-manager/shared';
import { Card, Space, Tag, Timeline, Typography } from 'antd';
import { formatDateTime } from '../../components/format.js';

function isFailure(log: SubaccountAuthLog): boolean {
  return log.status === 'error' || /fail|error|locked|invalid/i.test(log.status);
}

function logEvidence(log: SubaccountAuthLog): string {
  if (!log.data) return '';
  return Object.entries(log.data)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 5)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');
}

export function SubaccountLogPanel({ logs }: { logs: SubaccountAuthLog[] }) {
  return (
    <Card title="操作日志">
      {logs.length === 0 ? (
        <Typography.Text type="secondary">暂无日志</Typography.Text>
      ) : (
        <Timeline
          items={logs.map((log) => ({
            color: isFailure(log) ? 'red' : log.status === 'ok' || log.status === 'codex_ready' ? 'green' : 'blue',
            children: (
              <div className="timeline-item">
                <Space size={8} wrap>
                  <Typography.Text strong>{log.phase}</Typography.Text>
                  <Tag color={isFailure(log) ? 'error' : undefined}>{log.status}</Tag>
                  <Typography.Text type="secondary">{formatDateTime(log.createdAt)}</Typography.Text>
                </Space>
                <Typography.Paragraph>{log.message}</Typography.Paragraph>
                {logEvidence(log) && <Typography.Text type="secondary">{logEvidence(log)}</Typography.Text>}
              </div>
            )
          }))}
        />
      )}
    </Card>
  );
}
