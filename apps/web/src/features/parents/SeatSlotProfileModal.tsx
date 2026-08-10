import { useEffect, useState } from 'react';
import type { AccountSeatSlot, AccountSeatSlotProfileInput, AccountView } from '@team-manager/shared';
import { Form, Input, Modal, Switch, Typography } from 'antd';
import { ModalErrorAlert } from '../../components/ModalErrorAlert.js';

interface SeatSlotProfileValues {
  contact?: string;
  remark?: string;
  price?: string;
  expiresOn: string;
  expireRemove: boolean;
  expireReminder: boolean;
}

export function normalizeSeatSlotEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function defaultSeatSlotExpiresOn(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function seatSlotForEmail(account: AccountView, email: string): AccountSeatSlot | undefined {
  const target = normalizeSeatSlotEmail(email);
  return account.seatSlots?.find((slot) => slot.email?.toLowerCase() === target);
}

export function seatSlotProfileSummary(slot: AccountSeatSlot | undefined): string {
  if (!slot) return '未设置';
  return [slot.expiresOn, slot.expireReminder ? '提醒' : '不提醒', slot.expireRemove ? '到期移除' : '']
    .filter(Boolean)
    .join(' · ');
}

function initialValues(account: AccountView, email: string): SeatSlotProfileValues {
  const slot = seatSlotForEmail(account, email);
  return {
    contact: slot?.contact ?? '',
    remark: slot?.remark ?? '',
    price: slot?.price ?? '',
    expiresOn: slot?.expiresOn ?? defaultSeatSlotExpiresOn(),
    expireRemove: slot?.expireRemove ?? false,
    expireReminder: slot?.expireReminder ?? true
  };
}

export function SeatSlotProfileFields() {
  return (
    <>
      <div className="form-grid two">
        <Form.Item name="contact" label="联系方式">
          <Input placeholder="例如微信[昵称]、闲鱼[用户名]" />
        </Form.Item>
        <Form.Item name="price" label="价格">
          <Input placeholder="例如 120元" />
        </Form.Item>
      </div>
      <Form.Item name="remark" label="席位备注">
        <Input placeholder="只填写联系方式和价格之外的补充信息" />
      </Form.Item>
      <Form.Item name="expiresOn" label="席位到期日期" rules={[{ required: true, message: '请选择席位到期日期' }]}>
        <Input type="date" />
      </Form.Item>
      <div className="form-grid two">
        <Form.Item name="expireReminder" label="到期提醒" valuePropName="checked">
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>
        <Form.Item
          name="expireRemove"
          label="到期移除标记"
          valuePropName="checked"
          extra="仅作为运营标记，不会自动移出远端成员。"
        >
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>
      </div>
    </>
  );
}

export function SeatSlotProfileModal({
  open,
  email,
  sourceLabel,
  account,
  confirmLoading = false,
  onCancel,
  onSubmit
}: {
  open: boolean;
  email: string;
  sourceLabel: string;
  account: AccountView;
  confirmLoading?: boolean;
  onCancel: () => void;
  onSubmit: (email: string, input: AccountSeatSlotProfileInput) => Promise<void> | void;
}) {
  const [form] = Form.useForm<SeatSlotProfileValues>();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(initialValues(account, email));
    setError('');
  }, [account, email, form, open]);

  const submit = async () => {
    setError('');
    const values = await form.validateFields();
    try {
      await onSubmit(email, {
        contact: values.contact?.trim() ?? '',
        remark: values.remark?.trim() ?? '',
        price: values.price?.trim() ?? '',
        expiresOn: values.expiresOn,
        expireRemove: values.expireRemove,
        expireReminder: values.expireReminder
      });
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      title="编辑客户席位资料"
      okText="保存席位资料"
      cancelText="取消"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => void submit()}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        {email} · {sourceLabel}
      </Typography.Paragraph>
      <Form<SeatSlotProfileValues>
        form={form}
        layout="vertical"
        initialValues={initialValues(account, email)}
        disabled={confirmLoading}
      >
        <SeatSlotProfileFields />
      </Form>
      <ModalErrorAlert message={error} />
    </Modal>
  );
}
