import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { inspectChatGptSessionImportInput, type AccountLimitType, type ChatGptSessionInput } from '@team-manager/shared';
import { Alert, Descriptions, Form, Input, Modal, Select } from 'antd';
import { parseJsonObject } from './format.js';
import { formatLocalProfileSessionJson, shouldSubmitLocalProfileSession } from './localProfileSession.js';
import { LIMIT_TYPE_LABEL } from '../labels.js';

type LocalProfileMode = 'parent' | 'subaccount';

interface LocalProfileFormValues {
  remark?: string;
  groupName?: string;
  limitType?: AccountLimitType;
  nextRenewalOn?: string;
  proxy?: string;
  rawSession?: string;
}

export function LocalProfileModal({
  open,
  mode,
  title,
  description,
  initialValues,
  submitLabel = '保存',
  requireSession = false,
  confirmLoading = false,
  onCancel,
  onSubmit
}: {
  open: boolean;
  mode: LocalProfileMode;
  title: string;
  description: ReactNode;
  initialValues: {
    remark?: string;
    groupName?: string;
    limitType?: AccountLimitType;
    nextRenewalOn?: string;
    proxy?: string;
    session?: ChatGptSessionInput;
  };
  submitLabel?: string;
  requireSession?: boolean;
  confirmLoading?: boolean;
  onCancel: () => void;
  onSubmit: (payload: {
    remark?: string;
    groupName?: string;
    limitType?: AccountLimitType;
    nextRenewalOn?: string;
    proxy?: string;
    session?: unknown;
  }) => Promise<void>;
}) {
  const [form] = Form.useForm<LocalProfileFormValues>();
  const [rawSession, setRawSession] = useState('');
  const [error, setError] = useState('');
  const initialSessionJson = useMemo(
    () => formatLocalProfileSessionJson(initialValues.session),
    [initialValues.session]
  );

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      remark: initialValues.remark,
      groupName: initialValues.groupName || '默认分组',
      limitType: initialValues.limitType ?? 'unknown',
      nextRenewalOn: initialValues.nextRenewalOn ?? '',
      proxy: initialValues.proxy ?? '',
      rawSession: initialSessionJson
    });
    setRawSession(initialSessionJson);
    setError('');
  }, [
    form,
    initialValues.groupName,
    initialValues.limitType,
    initialValues.nextRenewalOn,
    initialValues.proxy,
    initialValues.remark,
    initialSessionJson,
    open
  ]);

  const sessionPreview = useMemo(() => {
    if (!rawSession.trim()) {
      return {
        email: '',
        accountId: '',
        inputMessage: '',
        inputAlertType: 'info' as const
      };
    }
    try {
      const payload = JSON.parse(rawSession) as unknown;
      const inspection = inspectChatGptSessionImportInput(payload);
      if (inspection.type === 'invalid') {
        return {
          email: '',
          accountId: '',
          inputMessage: inspection.message,
          inputAlertType: 'warning' as const
        };
      }
      return {
        email: inspection.email ?? '',
        accountId: inspection.accountId ?? '',
        inputMessage: inspection.message,
        inputAlertType: 'info' as const
      };
    } catch {
      return {
        email: '',
        accountId: '',
        inputMessage: 'JSON 解析失败，请检查格式',
        inputAlertType: 'warning' as const
      };
    }
  }, [mode, rawSession]);

  const submit = async (values: LocalProfileFormValues) => {
    setError('');
    try {
      let session: unknown;
      if (shouldSubmitLocalProfileSession(values.rawSession, initialSessionJson)) {
        session = parseJsonObject(values.rawSession ?? '');
      }
      await onSubmit({
        remark: values.remark?.trim() ?? '',
        proxy: values.proxy?.trim() ?? '',
        ...(mode === 'parent' ? {
          groupName: values.groupName?.trim() || '默认分组',
          limitType: values.limitType ?? 'unknown',
          nextRenewalOn: values.nextRenewalOn?.trim() ?? ''
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
      okText={submitLabel}
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
          <div className="form-grid two">
            <Form.Item name="remark" label="备注">
              <Input placeholder="例如用途、客户或订单备注" />
            </Form.Item>
            <Form.Item name="proxy" label="代理地址">
              <Input placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" />
            </Form.Item>
          </div>
        ) : (
          <div className="form-grid two">
            <Form.Item name="remark" label="备注">
              <Input placeholder="例如用途、客户或订单备注" />
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
            <Form.Item
              name="nextRenewalOn"
              label="下次续费时间"
              rules={[
                {
                  pattern: /^$|^\d{4}-\d{2}-\d{2}$/,
                  message: '请使用 yyyy-mm-dd'
                }
              ]}
            >
              <Input type="date" />
            </Form.Item>
            <Form.Item name="proxy" label="代理地址">
              <Input placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" />
            </Form.Item>
          </div>
        )}
        <Form.Item
          name="rawSession"
          label="Session JSON"
          rules={requireSession ? [{ required: true, message: '请粘贴 Session JSON' }] : undefined}
        >
          <Input.TextArea
            rows={8}
            spellCheck={false}
            placeholder="粘贴 chatgpt.com session JSON（建议包含 sessionToken）"
          />
        </Form.Item>
        {sessionPreview.inputMessage && (
          <Alert className="input-detection" type={sessionPreview.inputAlertType} showIcon message={sessionPreview.inputMessage} />
        )}
        <Descriptions size="small" column={mode === 'subaccount' ? 1 : 2} bordered>
          <Descriptions.Item label="识别邮箱">{sessionPreview.email || '暂无'}</Descriptions.Item>
          <Descriptions.Item label="workspace account_id">{sessionPreview.accountId || '暂无'}</Descriptions.Item>
        </Descriptions>
      </Form>
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
    </Modal>
  );
}
