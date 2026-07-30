import { StopOutlined } from '@ant-design/icons';
import { Button, Popconfirm } from 'antd';
import type {
  AccountManagerOperationStatus,
  SubaccountRegistrationJobStatus
} from '@team-manager/shared';

type RegistrationTaskStatus = AccountManagerOperationStatus | SubaccountRegistrationJobStatus;

export function registrationTaskCanCancel(status: RegistrationTaskStatus): boolean {
  return ['queued', 'running', 'waiting_for_otp', 'waiting_manual'].includes(status);
}

export function registrationTaskIsCancelled(phase: string): boolean {
  return phase === 'registration_cancelled';
}

export function RegistrationTaskCancelButton({
  loading,
  onConfirm
}: {
  loading: boolean;
  onConfirm: () => void;
}) {
  return (
    <Popconfirm
      title="取消当前注册任务？"
      description="取消后会停止并清理关联 Profile。任务会保留为“已取消”，仍可按原邮箱重试。"
      okText="取消任务"
      okButtonProps={{ danger: true }}
      cancelText="返回"
      onConfirm={onConfirm}
    >
      <Button
        danger
        size="small"
        icon={<StopOutlined />}
        loading={loading}
        onClick={(event) => event.stopPropagation()}
      >
        取消任务
      </Button>
    </Popconfirm>
  );
}
