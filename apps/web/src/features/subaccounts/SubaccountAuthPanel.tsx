import type { CodexAuthRuntimeStatus, SubaccountAuthLog } from '@team-manager/shared';
import { Alert, Card, Descriptions, Space, Steps, Tag, Timeline, Typography } from 'antd';
import { formatDateTime, shortText } from '../../components/format.js';
import {
  AUTH_PROGRESS_STEPS,
  authStepStatus,
  buildAuthProgress,
  isFailureLog,
  logMeta,
  phaseLabel
} from './subaccountAuthProgress.js';

function capabilityText(value: boolean | undefined): string {
  if (value === undefined) return '未检查';
  return value ? '可用' : '不可用';
}

function stepStatus(status: ReturnType<typeof authStepStatus>): 'wait' | 'process' | 'finish' | 'error' {
  if (status === 'done' || status === 'skipped') return 'finish';
  if (status === 'active') return 'process';
  if (status === 'error') return 'error';
  return 'wait';
}

export function SubaccountAuthPanel({
  runtimeStatus,
  logs,
  runningTarget
}: {
  runtimeStatus: CodexAuthRuntimeStatus | null;
  logs: SubaccountAuthLog[];
  runningTarget: string;
}) {
  const progress = buildAuthProgress(logs, runningTarget);

  return (
    <Space direction="vertical" size={16} className="panel-stack">
      <Card title="自动授权运行能力">
        <Descriptions column={{ xs: 1, md: 3 }} bordered size="small">
          <Descriptions.Item label="worker">{capabilityText(runtimeStatus?.workerReachable)}</Descriptions.Item>
          <Descriptions.Item label="自动授权">{capabilityText(runtimeStatus?.codexAutoAuth)}</Descriptions.Item>
          <Descriptions.Item label="自动注册">{capabilityText(runtimeStatus?.subaccountRegistration)}</Descriptions.Item>
          <Descriptions.Item label="GongXi-Mail">{capabilityText(runtimeStatus?.gongxiMail)}</Descriptions.Item>
          <Descriptions.Item label="短信接码">{capabilityText(runtimeStatus?.phoneOtp)}</Descriptions.Item>
          <Descriptions.Item label="授权页面">{capabilityText(runtimeStatus?.flaresolverr)}</Descriptions.Item>
        </Descriptions>
        {runtimeStatus?.phoneOtp && (
          <Typography.Paragraph className="runtime-note" type="secondary">
            号码池：{runtimeStatus.phonePoolCount ?? 0} 可用，{runtimeStatus.phonePoolExhaustedCount ?? 0} 用尽
          </Typography.Paragraph>
        )}
        {runtimeStatus?.error && <Alert type="warning" showIcon message={shortText(runtimeStatus.error)} />}
      </Card>

      <Card
        title="自动授权流程"
        extra={
          progress.failed ? (
            <Tag color="error">需要处理</Tag>
          ) : progress.completed ? (
            <Tag color="success">已完成</Tag>
          ) : progress.running ? (
            <Tag color="processing">运行中</Tag>
          ) : (
            <Tag>暂无运行</Tag>
          )
        }
      >
        <Steps
          responsive
          items={AUTH_PROGRESS_STEPS.map((step, index) => {
            const status = authStepStatus(step, index, progress);
            return {
              title: step.label,
              description: step.detail,
              status: stepStatus(status)
            };
          })}
        />
      </Card>

      <Card title="授权日志">
        {logs.length === 0 ? (
          <Typography.Text type="secondary">暂无日志</Typography.Text>
        ) : (
          <Timeline
            items={logs.map((log) => ({
              color: isFailureLog(log) ? 'red' : log.status === 'ok' || log.status === 'codex_ready' ? 'green' : 'blue',
              children: (
                <div className="timeline-item">
                  <Space size={8} wrap>
                    <Typography.Text strong>{phaseLabel(log.phase)}</Typography.Text>
                    <Tag color={isFailureLog(log) ? 'error' : undefined}>{log.status}</Tag>
                    <Typography.Text type="secondary">{formatDateTime(log.createdAt)}</Typography.Text>
                  </Space>
                  <Typography.Paragraph>{log.message}</Typography.Paragraph>
                  {logMeta(log) && <Typography.Text type="secondary">{logMeta(log)}</Typography.Text>}
                </div>
              )
            }))}
          />
        )}
      </Card>
    </Space>
  );
}
