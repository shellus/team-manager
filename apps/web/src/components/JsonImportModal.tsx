import { useEffect, useMemo, useState } from 'react';
import { getChatGptSessionUserEmail } from '@team-manager/shared';
import { Alert, Descriptions, Form, Input, Modal } from 'antd';
import { parseJsonObject, readStringField } from './format.js';

type JsonImportMode = 'session' | 'credential';

interface JsonImportFormValues {
  raw: string;
  fileName?: string;
  groupName?: string;
}

export function JsonImportModal({
  open,
  mode,
  title,
  description,
  submitLabel,
  confirmLoading = false,
  onCancel,
  onSubmit
}: {
  open: boolean;
  mode: JsonImportMode;
  title: string;
  description: string;
  submitLabel: string;
  confirmLoading?: boolean;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [form] = Form.useForm<JsonImportFormValues>();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ groupName: mode === 'credential' ? '默认号池' : undefined });
    setRaw('');
    setError('');
  }, [form, mode, open]);

  const preview = useMemo(() => {
    if (!raw.trim()) return { email: '', accountId: '', planType: '' };
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      if (mode === 'credential') {
        return {
          email: readStringField(payload, 'email'),
          accountId: readStringField(payload, 'account_id'),
          planType: readStringField(payload, 'plan_type')
        };
      }
      return {
        email: getChatGptSessionUserEmail(payload) ?? '',
        accountId:
          payload.account && typeof payload.account === 'object'
            ? readStringField(payload.account, 'id')
            : '',
        planType: ''
      };
    } catch {
      return { email: '', accountId: '', planType: '' };
    }
  }, [mode, raw]);

  const submit = async (values: JsonImportFormValues) => {
    setError('');
    try {
      const parsed = parseJsonObject(values.raw);
      if (mode === 'credential') {
        await onSubmit({
          credential: parsed,
          ...(values.fileName?.trim() ? { fileName: values.fileName.trim() } : {}),
          groupName: values.groupName?.trim() || '默认号池'
        });
      } else {
        await onSubmit(parsed);
      }
    } catch (submitError) {
      setError((submitError as Error).message);
      throw submitError;
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      okText={submitLabel}
      cancelText="取消"
      width={760}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnClose
    >
      <p className="modal-description">{description}</p>
      <Form<JsonImportFormValues>
        form={form}
        layout="vertical"
        onFinish={submit}
        onValuesChange={(_, values) => setRaw(values.raw ?? '')}
      >
        <Form.Item
          name="raw"
          label={mode === 'credential' ? 'Codex credential JSON' : 'Session JSON'}
          rules={[{ required: true, message: '请粘贴 JSON' }]}
        >
          <Input.TextArea
            rows={12}
            spellCheck={false}
            placeholder={
              mode === 'credential'
                ? '粘贴包含 email、account_id、access_token 等字段的 Codex credential JSON'
                : '粘贴 chatgpt.com session JSON'
            }
          />
        </Form.Item>

        {mode === 'credential' && (
          <div className="form-grid two">
            <Form.Item name="fileName" label="自定义文件名">
              <Input placeholder="可留空，由系统生成" />
            </Form.Item>
            <Form.Item name="groupName" label="CPA 号池">
              <Input placeholder="默认号池" />
            </Form.Item>
          </div>
        )}

        <Descriptions size="small" column={mode === 'credential' ? 3 : 2} bordered>
          <Descriptions.Item label="识别邮箱">{preview.email || '暂无'}</Descriptions.Item>
          <Descriptions.Item label="workspace account_id">{preview.accountId || '暂无'}</Descriptions.Item>
          {mode === 'credential' && <Descriptions.Item label="plan_type">{preview.planType || '暂无'}</Descriptions.Item>}
        </Descriptions>
      </Form>
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
    </Modal>
  );
}
