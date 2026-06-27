import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getChatGptSessionUserEmail, inspectChatGptSessionImportInput } from '@team-manager/shared';
import { Alert, Descriptions, Form, Input, Modal } from 'antd';
import { parseJsonObject, parseJsonValue, readStringField } from './format.js';

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
  allowBrowserCookies = false,
  onCancel,
  onSubmit
}: {
  open: boolean;
  mode: JsonImportMode;
  title: string;
  description: ReactNode;
  submitLabel: string;
  confirmLoading?: boolean;
  allowBrowserCookies?: boolean;
  onCancel: () => void;
  onSubmit: (payload: unknown) => Promise<void>;
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
    if (!raw.trim()) {
      return {
        email: '',
        accountId: '',
        planType: '',
        inputMessage: '',
        inputAlertType: 'info' as const,
        cookieCount: undefined as number | undefined
      };
    }
    try {
      const payload = JSON.parse(raw) as unknown;
      if (mode === 'credential') {
        const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
        return {
          email: readStringField(record, 'email'),
          accountId: readStringField(record, 'account_id'),
          planType: readStringField(record, 'plan_type'),
          inputMessage: '',
          inputAlertType: 'info' as const,
          cookieCount: undefined
        };
      }
      const inspection = inspectChatGptSessionImportInput(payload);
      if (inspection.type === 'browser_cookies' && !allowBrowserCookies) {
        return {
          email: '',
          accountId: '',
          planType: '',
          inputMessage: '当前入口不支持浏览器 cookies 数组',
          inputAlertType: 'warning' as const,
          cookieCount: inspection.cookieCount
        };
      }
      if (inspection.type === 'browser_cookies') {
        return {
          email: '提交后读取',
          accountId: '提交后读取',
          planType: '',
          inputMessage: inspection.message,
          inputAlertType: 'success' as const,
          cookieCount: inspection.cookieCount
        };
      }
      if (inspection.type === 'invalid') {
        return {
          email: '',
          accountId: '',
          planType: '',
          inputMessage: inspection.message,
          inputAlertType: 'warning' as const,
          cookieCount: undefined
        };
      }
      const record = payload as Record<string, unknown>;
      return {
        email: getChatGptSessionUserEmail(payload) ?? '',
        accountId:
          record.account && typeof record.account === 'object'
            ? readStringField(record.account, 'id')
            : '',
        planType: '',
        inputMessage: inspection.message,
        inputAlertType: 'info' as const,
        cookieCount: inspection.cookieCount
      };
    } catch {
      return {
        email: '',
        accountId: '',
        planType: '',
        inputMessage: 'JSON 解析失败，请检查格式',
        inputAlertType: 'warning' as const,
        cookieCount: undefined
      };
    }
  }, [allowBrowserCookies, mode, raw]);

  const submit = async (values: JsonImportFormValues) => {
    setError('');
    try {
      if (mode === 'credential') {
        const parsed = parseJsonObject(values.raw);
        await onSubmit({
          credential: parsed,
          ...(values.fileName?.trim() ? { fileName: values.fileName.trim() } : {}),
          groupName: values.groupName?.trim() || '默认号池'
        });
      } else {
        await onSubmit(allowBrowserCookies ? parseJsonValue(values.raw) : parseJsonObject(values.raw));
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
                : allowBrowserCookies
                  ? '粘贴 chatgpt.com session JSON（建议包含 sessionToken），或 Cookie Editor 导出的 cookies 数组'
                  : '粘贴 chatgpt.com session JSON（建议包含 sessionToken）'
            }
          />
        </Form.Item>

        {mode === 'session' && preview.inputMessage && (
          <Alert className="input-detection" type={preview.inputAlertType} showIcon message={preview.inputMessage} />
        )}

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

        <Descriptions size="small" column={mode === 'credential' || allowBrowserCookies ? 3 : 2} bordered>
          <Descriptions.Item label="识别邮箱">{preview.email || '暂无'}</Descriptions.Item>
          <Descriptions.Item label="workspace account_id">{preview.accountId || '暂无'}</Descriptions.Item>
          {mode === 'credential' && <Descriptions.Item label="plan_type">{preview.planType || '暂无'}</Descriptions.Item>}
          {mode === 'session' && allowBrowserCookies && (
            <Descriptions.Item label="cookies">{preview.cookieCount ? `${preview.cookieCount} 个` : '暂无'}</Descriptions.Item>
          )}
        </Descriptions>
      </Form>
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
    </Modal>
  );
}
