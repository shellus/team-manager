import type { AccountManagerOperationView } from '@team-manager/shared';
import { CloseOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Progress, Space, Tag, Tooltip, Typography } from 'antd';
import { shortText } from './format.js';

function operationStatusLabel(operation: AccountManagerOperationView): string {
  if (operation.status === 'waiting_for_otp') return '等待验证码';
  if (operation.status === 'waiting_manual') return '等待人工';
  if (operation.status === 'interrupted') {
    return operation.errorCode === 'operation_terminated_by_user' ? '已终止' : '操作中断';
  }
  if (operation.status === 'failed') return '操作失败';
  if (operation.status === 'queued') return '排队中';
  return '执行中';
}

function operationIsActive(operation: AccountManagerOperationView): boolean {
  return ['queued', 'running', 'waiting_for_otp', 'waiting_manual'].includes(operation.status);
}

function operationCanDismiss(operation: AccountManagerOperationView): boolean {
  return operation.status === 'failed' || operation.status === 'interrupted';
}

export function AccountOperationProgress({
  label,
  operation,
  isBusy,
  busyKeyScope = 'operation',
  onTerminate,
  onDismiss
}: {
  label: string;
  operation: AccountManagerOperationView;
  isBusy: (key: string) => boolean;
  busyKeyScope?: string;
  onTerminate: () => void;
  onDismiss: () => void;
}) {
  const failed = operation.status === 'failed' || operation.status === 'interrupted';
  const message = operation.errorMessage || operation.message || operation.phase;

  return (
    <div className="account-operation-progress" aria-live="polite">
      <div className="account-operation-progress-head">
        <Typography.Text strong>{label} 开通</Typography.Text>
        <Space size={2}>
          <Tag color={
            operation.status === 'waiting_manual' || operation.status === 'waiting_for_otp'
              ? 'warning'
              : failed
                ? 'error'
                : 'processing'
          }>
            {operationStatusLabel(operation)}
          </Tag>
          {operationCanDismiss(operation) && (
            <Tooltip title="清除错误">
              <Button
                className="operation-dismiss-button"
                type="text"
                size="small"
                shape="circle"
                aria-label="清除开通错误"
                icon={<CloseOutlined />}
                loading={isBusy(`dismiss-${busyKeyScope}-${operation.id}`)}
                onClick={(event) => {
                  event.stopPropagation();
                  onDismiss();
                }}
              />
            </Tooltip>
          )}
        </Space>
      </div>
      <Typography.Text
        className="account-operation-progress-message"
        type={failed ? 'danger' : 'secondary'}
        title={message}
      >
        {shortText(message, 96)}
      </Typography.Text>
      <Progress
        percent={operation.progress}
        size="small"
        status={failed ? 'exception' : operation.status === 'waiting_manual' ? 'normal' : 'active'}
        format={(percent) => `${percent ?? 0}%`}
      />
      {operationIsActive(operation) && (
        <Space
          size={6}
          wrap
          className="account-operation-actions"
          onClick={(event) => event.stopPropagation()}
        >
          <Popconfirm
            title="终止当前开通任务？"
            description="终止后会停止关联 profile，任务不会自动继续。"
            okText="终止任务"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={onTerminate}
          >
            <Button
              danger
              size="small"
              icon={<StopOutlined />}
              loading={isBusy(`terminate-${busyKeyScope}-${operation.id}`)}
              onClick={(event) => event.stopPropagation()}
            >
              终止任务
            </Button>
          </Popconfirm>
        </Space>
      )}
    </div>
  );
}
