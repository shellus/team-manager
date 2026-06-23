import { BILLING_RISK_CONFIRM_MESSAGE } from '@team-manager/shared';
import { Alert, Modal } from 'antd';

export function BillingRiskModal({
  open,
  title = '确认账单风险',
  confirmLabel = '确认继续',
  confirmLoading = false,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title?: string;
  confirmLabel?: string;
  confirmLoading?: boolean;
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
      <Alert type="warning" showIcon message={BILLING_RISK_CONFIRM_MESSAGE} />
    </Modal>
  );
}
