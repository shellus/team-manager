import type {
  AccountManagerOperationStatus,
  SubaccountRegistrationJobStatus
} from '@team-manager/shared';
import { Card, Progress, Space, Tabs, Tag, Typography } from 'antd';
import { useCallback } from 'react';
import { apiClient } from '../api.js';
import { ResidentialProxyConfigurationPanel } from './ResidentialProxyConfigurationPanel.js';
import {
  RegistrationTaskCancelButton,
  registrationTaskCanCancel,
  registrationTaskIsCancelled
} from './RegistrationTaskCancelButton.js';

export function PendingRegistrationAccountManagerDetail({
  recordLabel,
  operationId,
  email,
  message,
  progress,
  status,
  phase,
  cancelLoading = false,
  onCancel,
  failed = false,
  waitingManual = false
}: {
  recordLabel: '母号' | '子号';
  operationId: string;
  email?: string;
  message: string;
  progress: number;
  status: AccountManagerOperationStatus | SubaccountRegistrationJobStatus;
  phase: string;
  cancelLoading?: boolean;
  onCancel?: () => void;
  failed?: boolean;
  waitingManual?: boolean;
}) {
  const cancelled = registrationTaskIsCancelled(phase);
  const canCancel = registrationTaskCanCancel(status) && Boolean(onCancel);
  const loadConfig = useCallback(() => recordLabel === '母号'
    ? apiClient.getParentRegistrationProxy(operationId)
    : apiClient.getSubaccountRegistrationProxy(operationId), [operationId, recordLabel]);
  const saveConfig = useCallback((config: Parameters<
    typeof apiClient.updateParentRegistrationProxy
  >[1]) => recordLabel === '母号'
    ? apiClient.updateParentRegistrationProxy(operationId, config)
    : apiClient.updateSubaccountRegistrationProxy(operationId, config), [operationId, recordLabel]);

  return (
    <Card className="detail-pane">
      <div className="detail-header pending-registration-header">
        <div>
          <Space align="center" wrap>
            <Typography.Title level={2}>{email || `自动注册${recordLabel}`}</Typography.Title>
            <Tag color={cancelled ? 'default' : failed ? 'error' : waitingManual ? 'warning' : 'processing'}>
              {cancelled ? '已取消' : failed ? '操作失败' : waitingManual ? '等待人工处理' : '注册中'}
            </Tag>
          </Space>
          <Typography.Text type="secondary">{message}</Typography.Text>
        </div>
        <Space direction="vertical" align="end">
          <Progress
            className="pending-registration-progress"
            type="circle"
            size={58}
            percent={progress}
            status={cancelled ? 'normal' : failed ? 'exception' : 'active'}
          />
          {canCancel && (
            <RegistrationTaskCancelButton loading={cancelLoading} onConfirm={onCancel!} />
          )}
        </Space>
      </div>
      <Tabs
        activeKey="account-manager"
        items={[{
          key: 'account-manager',
          label: '账号管理',
          children: (
            <ResidentialProxyConfigurationPanel
              loadConfig={loadConfig}
              saveConfig={saveConfig}
            />
          )
        }]}
      />
    </Card>
  );
}
