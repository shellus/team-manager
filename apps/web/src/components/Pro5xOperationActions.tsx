import { RedoOutlined, StopOutlined, SwapOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Space } from 'antd';
import { isActionBusy, type ActionBusyState } from './actionBusy.js';

export function Pro5xOperationActions({
  operationId,
  busyState,
  onRetryCurrentStep,
  onRotateIp,
  onTerminate
}: {
  operationId: string;
  busyState: ActionBusyState;
  onRetryCurrentStep: () => void;
  onRotateIp: () => void;
  onTerminate: () => void;
}) {
  const retryKey = `retry-pro5x-${operationId}`;
  const rotateKey = `rotate-pro5x-${operationId}`;
  const terminateKey = `terminate-pro5x-${operationId}`;
  const retrying = isActionBusy(busyState, retryKey);
  const rotating = isActionBusy(busyState, rotateKey);
  const terminating = isActionBusy(busyState, terminateKey);
  const busy = retrying || rotating || terminating;

  return (
    <Space size={8} wrap>
      <Popconfirm
        title="重试当前 Pro 5x 步骤？"
        description="保留当前 Profile、SID 和 IP，重新创建或填写付款页面并自动点击 Subscribe。"
        okText="重试当前步骤"
        cancelText="取消"
        onConfirm={onRetryCurrentStep}
      >
        <Button
          size="small"
          type="primary"
          icon={<RedoOutlined />}
          loading={retrying}
          disabled={busy && !retrying}
        >
          重试当前步骤
        </Button>
      </Popconfirm>
      <Popconfirm
        title="更换 IP 并重试？"
        description="轮换住宅 SID、断开旧代理连接并重新执行；已提交过付款时会记录为下一次尝试。"
        okText="更换 IP 并重试"
        cancelText="取消"
        onConfirm={onRotateIp}
      >
        <Button
          size="small"
          icon={<SwapOutlined />}
          loading={rotating}
          disabled={busy && !rotating}
        >
          更换 IP 并重试
        </Button>
      </Popconfirm>
      <Popconfirm
        title="终止当前 Pro 5x 开通任务？"
        description="终止后会停止关联 Profile，任务不会自动继续。"
        okText="终止任务"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onConfirm={onTerminate}
      >
        <Button
          danger
          size="small"
          icon={<StopOutlined />}
          loading={terminating}
          disabled={busy && !terminating}
        >
          终止任务
        </Button>
      </Popconfirm>
    </Space>
  );
}
