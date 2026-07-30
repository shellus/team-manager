import type { RegistrationFormPreference } from '@team-manager/shared';
import { AutoComplete, Form, Modal, Select, Space, Typography } from 'antd';
import { useEffect, useMemo } from 'react';
import { ACCOUNT_PROXY_COUNTRIES } from './teamCheckoutOptions.js';
import { ModalErrorAlert } from './ModalErrorAlert.js';

export function RegistrationStartModal({
  open,
  title,
  description,
  initialValues,
  groupNames,
  confirmLoading,
  error,
  onCancel,
  onSubmit
}: {
  open: boolean;
  title: string;
  description: string;
  initialValues: RegistrationFormPreference;
  groupNames: string[];
  confirmLoading: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (values: RegistrationFormPreference) => void | Promise<void>;
}) {
  const [form] = Form.useForm<RegistrationFormPreference>();
  const groupOptions = useMemo(() => [...new Set([
    initialValues.groupName,
    '默认分组',
    ...groupNames.map((name) => name.trim()).filter(Boolean)
  ])].map((value) => ({ value })), [groupNames, initialValues.groupName]);

  useEffect(() => {
    form.resetFields();
    form.setFieldsValue(initialValues);
  }, [form, initialValues, open]);

  return (
    <Modal
      open={open}
      title={title}
      okText="开始注册"
      cancelText="取消"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => form.submit()}
      forceRender
    >
      <Space direction="vertical" size={12} className="panel-stack">
        <Typography.Paragraph>{description}</Typography.Paragraph>
        <Form<RegistrationFormPreference>
          form={form}
          layout="vertical"
          disabled={confirmLoading}
          initialValues={initialValues}
          onFinish={onSubmit}
        >
          <Form.Item
            name="country"
            label="国家"
            rules={[{ required: true, message: '请选择注册国家' }]}
            extra="任务创建时即应用到 GAM 的住宅代理国家。"
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={ACCOUNT_PROXY_COUNTRIES}
              placeholder="搜索国家代码或中文名"
            />
          </Form.Item>
          <Form.Item
            name="groupName"
            label="所属分组"
            rules={[{ required: true, whitespace: true, message: '请输入所属分组' }]}
            extra="可以选择已有分组，也可以直接输入新分组。"
          >
            <AutoComplete
              options={groupOptions}
              filterOption={(input, option) =>
                String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())}
              placeholder="选择或输入分组"
            />
          </Form.Item>
        </Form>
        <ModalErrorAlert message={error} />
      </Space>
    </Modal>
  );
}
