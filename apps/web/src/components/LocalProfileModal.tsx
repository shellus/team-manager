import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getChatGptSessionUserEmail, inspectChatGptSessionImportInput, type AccountLimitType } from '@team-manager/shared';
import { Alert, Descriptions, Form, Input, Modal, Select } from 'antd';
import { parseJsonObject, parseJsonValue } from './format.js';
import { LIMIT_TYPE_LABEL } from '../labels.js';

type LocalProfileMode = 'parent' | 'subaccount';

function readNestedAccountId(payload: Record<string, unknown>): string {
  const account = payload.account;
  if (!account || typeof account !== 'object') return '';
  const id = (account as Record<string, unknown>).id;
  return typeof id === 'string' ? id : '';
}

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
  description: ReactNode;
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
    session?: unknown;
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

  const sessionPreview = useMemo(() => {
    if (!rawSession.trim()) {
      return {
        email: '',
        accountId: '',
        inputMessage: '',
        inputAlertType: 'info' as const,
        cookieCount: undefined as number | undefined
      };
    }
    try {
      const payload = JSON.parse(rawSession) as unknown;
      if (mode !== 'subaccount') {
        return {
          email: getChatGptSessionUserEmail(payload) ?? '',
          accountId:
            payload && typeof payload === 'object' && !Array.isArray(payload)
              ? readNestedAccountId(payload as Record<string, unknown>)
              : '',
          inputMessage: Array.isArray(payload) ? '浏览器 cookies 只支持子号录入' : '',
          inputAlertType: 'warning' as const,
          cookieCount: undefined
        };
      }
      const inspection = inspectChatGptSessionImportInput(payload);
      if (inspection.type === 'browser_cookies') {
        return {
          email: '提交后读取',
          accountId: '提交后读取',
          inputMessage: inspection.message,
          inputAlertType: 'success' as const,
          cookieCount: inspection.cookieCount
        };
      }
      if (inspection.type === 'invalid') {
        return {
          email: '',
          accountId: '',
          inputMessage: inspection.message,
          inputAlertType: 'warning' as const,
          cookieCount: undefined
        };
      }
      return {
        email: inspection.email ?? '',
        accountId: inspection.accountId ?? '',
        inputMessage: inspection.message,
        inputAlertType: 'info' as const,
        cookieCount: inspection.cookieCount
      };
    } catch {
      return {
        email: '',
        accountId: '',
        inputMessage: 'JSON 解析失败，请检查格式',
        inputAlertType: 'warning' as const,
        cookieCount: undefined
      };
    }
  }, [mode, rawSession]);

  const submit = async (values: LocalProfileFormValues) => {
    setError('');
    try {
      let session: unknown;
      if (values.rawSession?.trim()) {
        session = mode === 'subaccount' ? parseJsonValue(values.rawSession) : parseJsonObject(values.rawSession);
      }
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
          <Input.TextArea
            rows={8}
            spellCheck={false}
            placeholder={
              mode === 'subaccount'
                ? '可留空。粘贴 chatgpt.com session JSON，或 Cookie Editor 导出的 cookies 数组'
                : '可留空。需要更换 session 时粘贴 chatgpt.com session JSON'
            }
          />
        </Form.Item>
        {mode === 'subaccount' && sessionPreview.inputMessage && (
          <Alert className="input-detection" type={sessionPreview.inputAlertType} showIcon message={sessionPreview.inputMessage} />
        )}
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="识别邮箱">{sessionPreview.email || '暂无'}</Descriptions.Item>
          {mode === 'subaccount' && (
            <>
              <Descriptions.Item label="workspace account_id">{sessionPreview.accountId || '暂无'}</Descriptions.Item>
              <Descriptions.Item label="cookies">
                {sessionPreview.cookieCount ? `${sessionPreview.cookieCount} 个` : '暂无'}
              </Descriptions.Item>
            </>
          )}
        </Descriptions>
      </Form>
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
    </Modal>
  );
}
