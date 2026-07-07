import { Alert } from 'antd';

export function ModalErrorAlert({ message }: { message?: string }) {
  if (!message) return null;
  return <Alert className="modal-error" type="error" showIcon message={message} />;
}
