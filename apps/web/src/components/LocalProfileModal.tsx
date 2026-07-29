import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { inspectChatGptSessionImportInput, type AccountLimitType, type ChatGptSessionInput } from '@team-manager/shared';
import { Alert, Descriptions, Form, Input, Modal, Select, Skeleton, Switch } from 'antd';
import { parseJsonObject } from './format.js';
import { formatLocalProfileSessionJson, shouldSubmitLocalProfileSession } from './localProfileSession.js';
import { LIMIT_TYPE_LABEL } from '../labels.js';

type LocalProfileMode = 'parent' | 'subaccount';

interface LocalProfileFormValues {
  remark?: string;
  groupName?: string;
  limitType?: AccountLimitType;
  isBanned?: boolean;
  nextRenewalOn?: string;
  proxy?: string;
  manageWithAccountManager?: boolean;
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
  showAccountManagerEnrollment = false,
  loading = false,
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
    isBanned?: boolean;
    nextRenewalOn?: string;
    proxy?: string;
    manageWithAccountManager?: boolean;
    session?: ChatGptSessionInput;
  };
  submitLabel?: string;
  requireSession?: boolean;
  showAccountManagerEnrollment?: boolean;
  loading?: boolean;
  confirmLoading?: boolean;
  onCancel: () => void;
  onSubmit: (payload: {
    remark?: string;
    groupName?: string;
    limitType?: AccountLimitType;
    isBanned?: boolean;
    nextRenewalOn?: string;
    proxy?: string;
    manageWithAccountManager?: boolean;
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
      isBanned: initialValues.isBanned ?? false,
      nextRenewalOn: initialValues.nextRenewalOn ?? '',
      proxy: initialValues.proxy ?? '',
      manageWithAccountManager: initialValues.manageWithAccountManager ?? false,
      rawSession: initialSessionJson
    });
    setRawSession(initialSessionJson);
    setError('');
  }, [
    form,
    initialValues.groupName,
    initialValues.isBanned,
    initialValues.limitType,
    initialValues.nextRenewalOn,
    initialValues.proxy,
    initialValues.manageWithAccountManager,
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
        groupName: values.groupName?.trim() || '默认分组',
        isBanned: values.isBanned ?? false,
        proxy: values.proxy?.trim() ?? '',
        ...(showAccountManagerEnrollment
          ? { manageWithAccountManager: values.manageWithAccountManager === true }
          : {}),
        ...(mode === 'parent' ? {
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
      okButtonProps={{ disabled: loading }}
      onCancel={onCancel}
      onOk={() => {
        if (!loading) form.submit();
      }}
      destroyOnClose
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <>
          <p className="modal-description">{description}</p>
          <Form<LocalProfileFormValues>
            form={form}
            layout="vertical"
            onFinish={submit}
            onValuesChange={(_, values) => setRawSession(values.rawSession ?? '')}
          >
            <div className="form-grid two">
              <Form.Item name="remark" label="备注">
                <Input placeholder="例如用途、客户或订单备注" />
              </Form.Item>
              <Form.Item
                name="groupName"
                label={mode === 'parent' ? '母号分组' : '子号分组'}
                rules={[{ required: true, message: '请输入分组' }]}
              >
                <Input placeholder="例如默认分组" />
              </Form.Item>
              {mode === 'parent' && (
                <>
                  <Form.Item
                    name="limitType"
                    label="限额类型"
                    rules={[{ required: true, message: '请选择限额类型' }]}
                  >
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
                </>
              )}
            </div>
            <Form.Item
              name="isBanned"
              label="封号标记"
              valuePropName="checked"
              extra={mode === 'parent'
                ? '封号母号的空位不计入概览；其他操作不受限制。'
                : '封号子号不能邀请加入 Team；其他操作不受限制。'}
            >
              <Switch checkedChildren="已封号" unCheckedChildren="正常" />
            </Form.Item>
            <Form.Item name="proxy" label="代理地址">
              <Input placeholder="http://proxy-host:port 或 socks5://proxy-host:port" />
            </Form.Item>
            {showAccountManagerEnrollment && (
              <Form.Item
                name="manageWithAccountManager"
                label="GPT Account Manager"
                valuePropName="checked"
                extra="保存 Session 后发起 GAM 导入；GAM 建立浏览器身份归档后自动关联。关闭后只保存 Team Manager 本地记录。"
              >
                <Switch checkedChildren="同时纳管" unCheckedChildren="仅本地" />
              </Form.Item>
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
        </>
      )}
    </Modal>
  );
}
