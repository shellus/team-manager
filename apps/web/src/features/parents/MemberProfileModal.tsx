import { useEffect, useState } from 'react';
import type { AccountMemberProfileInput, AccountSeatSlot, AccountView } from '@team-manager/shared';
import { Form, Input, Modal, Switch, Typography } from 'antd';
import { ModalErrorAlert } from '../../components/ModalErrorAlert.js';

interface MemberProfileValues {
  remark?: string;
  expiresOn: string;
  expireRemove: boolean;
  expireReminder: boolean;
}

export function normalizeMemberProfileEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function defaultMemberProfileExpiresOn(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function memberProfileForEmail(
  account: AccountView,
  email: string
): AccountSeatSlot | undefined {
  const target = normalizeMemberProfileEmail(email);
  return account.seatSlots?.find((slot) => slot.email?.toLowerCase() === target);
}

export function memberProfileSummary(profile: AccountSeatSlot | undefined): string {
  if (!profile) return '未设置';
  return [profile.expiresOn, profile.expireReminder ? '提醒' : '不提醒', profile.expireRemove ? '到期移除' : '']
    .filter(Boolean)
    .join(' · ');
}

function initialValues(account: AccountView, email: string): MemberProfileValues {
  const profile = memberProfileForEmail(account, email);
  return {
    remark: profile?.remark ?? '',
    expiresOn: profile?.expiresOn ?? defaultMemberProfileExpiresOn(),
    expireRemove: profile?.expireRemove ?? false,
    expireReminder: profile?.expireReminder ?? true
  };
}

export function MemberProfileFields() {
  return (
    <>
      <Form.Item name="remark" label="备注文本">
        <Input placeholder="例如客户名、用途或订单备注" />
      </Form.Item>
      <Form.Item name="expiresOn" label="到期时间" rules={[{ required: true, message: '请选择到期时间' }]}>
        <Input type="date" />
      </Form.Item>
      <div className="form-grid two">
        <Form.Item name="expireReminder" label="到期提醒" valuePropName="checked">
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>
        <Form.Item name="expireRemove" label="到期移除" valuePropName="checked">
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>
      </div>
    </>
  );
}

export function MemberProfileModal({
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
  onSubmit: (email: string, input: AccountMemberProfileInput) => Promise<void> | void;
}) {
  const [form] = Form.useForm<MemberProfileValues>();
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
        remark: values.remark?.trim() ?? '',
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
      title="编辑邮箱资料"
      okText="保存资料"
      cancelText="取消"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => void submit()}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        {email} · {sourceLabel}
      </Typography.Paragraph>
      <Form<MemberProfileValues>
        form={form}
        layout="vertical"
        initialValues={initialValues(account, email)}
        disabled={confirmLoading}
      >
        <MemberProfileFields />
      </Form>
      <ModalErrorAlert message={error} />
    </Modal>
  );
}
