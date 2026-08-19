import { Alert, Button, Form, Input, Select, Space } from 'antd';
import type {
  AccountGroupView,
  AccountManagerOperationView,
  RegisterAccountRequest,
} from '@team-manager/shared';
import { useEffect, useState } from 'react';
import { ProductModal, useProductMessage } from '../../components/ProductOverlays.js';
import { unifiedApi } from '../../unifiedApi.js';
import {
  loadGamRegistrationDefaults,
  saveGamRegistrationDefaults,
} from './serverFormDefaults.js';

export function AccountRegistrationModal({
  groups,
  open,
  onClose,
  onOperationCreated,
}: {
  groups: Array<Pick<AccountGroupView, 'id' | 'name'>>;
  open: boolean;
  onClose: () => void;
  onOperationCreated: (operation: AccountManagerOperationView) => void | Promise<void>;
}) {
  const productMessage = useProductMessage();
  const [form] = Form.useForm<RegisterAccountRequest>();
  const [saving, setSaving] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    form.resetFields();
    setError('');
    setLoadingDefaults(true);
    void loadGamRegistrationDefaults()
      .then((defaults) => {
        if (!active) return;
        form.setFieldsValue({
          ...defaults,
          groupId: defaults.groupId && groups.some((group) => group.id === defaults.groupId)
            ? defaults.groupId
            : undefined,
        });
      })
      .catch((reason) => {
        if (active) setError(`读取注册默认值失败：${(reason as Error).message}`);
      })
      .finally(() => {
        if (active) setLoadingDefaults(false);
      });
    return () => {
      active = false;
    };
  }, [form, open]);

  return (
    <ProductModal
      title="通过 GAM 注册"
      open={open}
      onCancel={onClose}
      width={640}
      footer={(
        <Space>
          <Button onClick={onClose} disabled={saving}>取消</Button>
          <Button type="primary" loading={saving || loadingDefaults} onClick={() => form.submit()}>
            启动 GAM 注册
          </Button>
        </Space>
      )}
    >
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
      <Form<RegisterAccountRequest>
        form={form}
        layout="vertical"
        initialValues={{ country: 'US' }}
        className="account-action-form"
        onFinish={async (values) => {
          setSaving(true);
          setError('');
          const input = {
            ...values,
            email: values.email?.trim() || undefined,
            country: values.country?.trim().toUpperCase() || undefined,
            mailGroup: values.mailGroup?.trim() || undefined,
          };
          try {
            const operation = await unifiedApi.registerAccount(input);
            try {
              await saveGamRegistrationDefaults({
                groupId: input.groupId,
                country: input.country ?? 'US',
                mailGroup: input.mailGroup,
              });
            } catch (reason) {
              productMessage.warning(`注册已启动，但保存默认值失败：${(reason as Error).message}`);
            }
            productMessage.success('GAM 注册已启动');
            await onOperationCreated(operation);
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form.Item
          name="groupId"
          label="注册后分组"
          rules={[{ required: true, message: '请选择分组' }]}
        >
          <Select
            placeholder="选择分组"
            options={groups.map((group) => ({ value: group.id, label: group.name }))}
          />
        </Form.Item>
        <Form.Item
          name="email"
          label="指定邮箱"
          extra="留空时由 GAM 分配邮箱。"
          rules={[{ type: 'email', message: '请输入有效邮箱' }]}
        >
          <Input autoComplete="email" />
        </Form.Item>
        <div className="responsive-form-grid">
          <Form.Item name="country" label="国家代码">
            <Input maxLength={2} autoComplete="country" />
          </Form.Item>
          <Form.Item name="mailGroup" label="邮箱组">
            <Input />
          </Form.Item>
        </div>
      </Form>
    </ProductModal>
  );
}
