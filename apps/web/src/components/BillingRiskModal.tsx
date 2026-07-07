import { BILLING_RISK_CONFIRM_MESSAGE } from '@team-manager/shared';
import { Alert, Modal, Space } from 'antd';
import { ModalErrorAlert } from './ModalErrorAlert.js';

export function BillingRiskModal({
  open,
  title = '确认账单风险',
  confirmLabel = '确认继续',
  confirmLoading = false,
  error,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title?: string;
  confirmLabel?: string;
  confirmLoading?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      okText={confirmLabel}
      cancelText="取消"
      okButtonProps={{ danger: true }}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={onConfirm}
      destroyOnClose
    >
      <Space direction="vertical" size={12} className="panel-stack">
        <Alert type="warning" showIcon message={BILLING_RISK_CONFIRM_MESSAGE} />
        <ModalErrorAlert message={error} />
      </Space>
    </Modal>
  );
}
