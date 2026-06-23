import { useEffect, useMemo, useState } from 'react';
import { getChatGptSessionUserEmail, type AccountLimitType } from '@team-manager/shared';
import { Alert, Descriptions, Form, Input, Modal, Select } from 'antd';
import { parseJsonObject } from './format.js';
import { LIMIT_TYPE_LABEL } from '../labels.js';

type LocalProfileMode = 'parent' | 'subaccount';

interface LocalProfileFormValues {
  label?: string;
  note?: string;
  groupName?: string;
  limitType?: AccountLimitType;
  rawSession?: string;
}

export function LocalProfileModal({
  open,
  mode,
  title,
  description,
  initialValues,
  confirmLoading = false,
  onCancel,
  onSubmit
}: {
  open: boolean;
  mode: LocalProfileMode;
  title: string;
  description: string;
  initialValues: {
    label?: string;
    note?: string;
    groupName?: string;
    limitType?: AccountLimitType;
  };
  confirmLoading?: boolean;
  onCancel: () => void;
  onSubmit: (payload: {
    label?: string;
    note?: string;
    groupName?: string;
    limitType?: AccountLimitType;
    session?: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const [form] = Form.useForm<LocalProfileFormValues>();
  const [rawSession, setRawSession] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      label: initialValues.label,
      note: initialValues.note,
      groupName: initialValues.groupName || '默认分组',
      limitType: initialValues.limitType ?? 'unknown',
      rawSession: ''
    });
    setRawSession('');
    setError('');
  }, [form, initialValues.groupName, initialValues.label, initialValues.limitType, initialValues.note, open]);

  const detectedEmail = useMemo(() => {
    if (!rawSession.trim()) return '';
    try {
      return getChatGptSessionUserEmail(JSON.parse(rawSession)) ?? '';
    } catch {
      return '';
    }
  }, [rawSession]);

  const submit = async (values: LocalProfileFormValues) => {
    setError('');
    try {
      let session: Record<string, unknown> | undefined;
      if (values.rawSession?.trim()) session = parseJsonObject(values.rawSession);
      await onSubmit({
        ...(mode === 'subaccount' ? { label: values.label?.trim() } : {}),
        ...(mode === 'parent' ? {
          note: values.note?.trim(),
          groupName: values.groupName?.trim() || '默认分组',
          limitType: values.limitType ?? 'unknown'
        } : {}),
        ...(session ? { session } : {})
      });
    } catch (submitError) {
      setError((submitError as Error).message);
      throw submitError;
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      okText="保存"
      cancelText="取消"
      width={720}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnClose
    >
      <p className="modal-description">{description}</p>
      <Form<LocalProfileFormValues>
        form={form}
        layout="vertical"
        onFinish={submit}
        onValuesChange={(_, values) => setRawSession(values.rawSession ?? '')}
      >
        {mode === 'subaccount' ? (
          <Form.Item name="label" label="本地备注名" rules={[{ required: true, message: '请输入本地备注名' }]}>
            <Input placeholder="用于本系统列表展示" />
          </Form.Item>
        ) : (
          <div className="form-grid three">
            <Form.Item name="note" label="母号备注">
              <Input placeholder="例如用途、客户、到期时间" />
            </Form.Item>
            <Form.Item name="groupName" label="母号分组" rules={[{ required: true, message: '请输入分组' }]}>
              <Input placeholder="例如默认分组" />
            </Form.Item>
            <Form.Item name="limitType" label="限额类型" rules={[{ required: true, message: '请选择限额类型' }]}>
              <Select<AccountLimitType>
                options={[
                  { value: 'unknown', label: LIMIT_TYPE_LABEL.unknown },
                  { value: 'weekly', label: LIMIT_TYPE_LABEL.weekly },
                  { value: 'monthly', label: LIMIT_TYPE_LABEL.monthly }
                ]}
              />
            </Form.Item>
          </div>
        )}
        <Form.Item name="rawSession" label="新的 Session JSON">
          <Input.TextArea rows={8} spellCheck={false} placeholder="可留空。需要更换 session 时粘贴 chatgpt.com session JSON" />
        </Form.Item>
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="识别邮箱">{detectedEmail || '暂无'}</Descriptions.Item>
        </Descriptions>
      </Form>
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
    </Modal>
  );
}
