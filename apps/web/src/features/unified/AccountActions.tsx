import { useEffect, useState, type MouseEvent } from "react";
import { Alert, Button, Form, Input, Select, Space, Switch } from "antd";
import type {
  AccountGroupView,
  AccountLimitType,
  AutomationOperationView,
  ResidentialProxyConfig,
} from "@team-manager/shared";
import { ProxyConfigurationFields } from "../../components/ProxyConfigurationFields.js";
import { unifiedApi } from "../../unifiedApi.js";
import { ApiError } from "../../api.js";
import {
  parseSessionEditorInput,
  type AccountActionModal,
  type AccountActionSummary,
} from "./accountActionsModel.js";
import { SubscriptionModal } from "./SubscriptionModal.js";
import { ProductModal, useProductMessage, useProductModal } from "../../components/ProductOverlays.js";

export function AccountActionButtons({
  onOpen,
}: {
  onOpen: (action: AccountActionModal) => void;
}) {
  const stopPropagation = (event: MouseEvent<HTMLElement>) =>
    event.stopPropagation();

  const actionButton = (action: AccountActionModal, label: string) => (
    <Button
      size="small"
      onClick={(event) => {
        stopPropagation(event);
        onOpen(action);
      }}
    >
      {label}
    </Button>
  );

  return (
    <Space
      wrap
      size={[6, 6]}
      className="account-action-buttons"
      onClick={stopPropagation}
    >
      {actionButton("proxy", "住宅代理")}
      {actionButton("subscription", "升级套餐")}
      {actionButton("edit", "编辑")}
    </Space>
  );
}

export function AccountActionModals({
  account,
  action,
  onClose,
  onChanged,
  onOperationCreated,
}: {
  account?: AccountActionSummary;
  action?: AccountActionModal;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onOperationCreated?: (operation: AutomationOperationView) => void;
}) {
  if (!account) return null;
  return (
    <>
      <ProxyModal
        accountId={account.id}
        open={action === "proxy"}
        onClose={onClose}
        onSaved={onChanged}
      />
      <SubscriptionModal
        accountId={account.id}
        currentPlan={account.personalPlan}
        open={action === "subscription"}
        onClose={onClose}
        onChanged={onChanged}
        onOperationCreated={onOperationCreated}
      />
      <AccountEditorModal
        account={account}
        open={action === "edit"}
        onClose={onClose}
        onSaved={onChanged}
      />
    </>
  );
}

function ProxyModal({
  accountId,
  open,
  onClose,
  onSaved,
}: {
  accountId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const productMessage = useProductMessage();
  const productModal = useProductModal();
  const [form] = Form.useForm<ResidentialProxyConfig>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    void unifiedApi
      .residentialProxy(accountId)
      .then((proxy) => {
        setConfigured(Boolean(proxy));
        form.setFieldsValue(
          proxy ?? { sid: "", country: "US", asn: null, state: null, city: null },
        );
      })
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setLoading(false));
  }, [accountId, form, open]);

  return (
    <ProductModal
      title="住宅代理"
      open={open}
      onCancel={onClose}
      width={640}
    >
      <Alert
        type="info"
        showIcon
        message="账号的 ChatGPT 请求经 Team Manager 住宅代理网关按此配置出站；修改 8 位 SID 会更换粘性会话并获得新 IP。ASN 与州/省、城市是两种互斥定位方式；保存后会替换账号原有的手工代理地址。"
      />
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
      <Form
        form={form}
        layout="vertical"
        disabled={loading}
        className="account-action-form"
        onFinish={async (values) => {
          setSaving(true);
          setError("");
          try {
            await unifiedApi.configureResidentialProxy(accountId, {
              sid: values.sid,
              country: values.country.toUpperCase(),
              asn: values.asn || null,
              state: values.state || null,
              city: values.city || null,
            });
            productMessage.success("代理配置已保存");
            await onSaved();
            onClose();
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <ProxyConfigurationFields form={form} showRandomSidButton />
        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存代理配置
          </Button>
          {configured && (
            <Button
              danger
              disabled={saving}
              onClick={() => productModal.confirm({
                title: "清除住宅代理？",
                content: "清除后账号回退到默认出口。",
                okText: "清除",
                okButtonProps: { danger: true },
                onOk: async () => {
                  setSaving(true);
                  setError("");
                  try {
                    await unifiedApi.clearResidentialProxy(accountId);
                    productMessage.success("住宅代理已清除");
                    await onSaved();
                    onClose();
                  } catch (reason) {
                    setError((reason as Error).message);
                  } finally {
                    setSaving(false);
                  }
                },
              })}
            >
              清除住宅代理
            </Button>
          )}
        </Space>
      </Form>
    </ProductModal>
  );
}

type AccountEditorValues = {
  email?: string;
  groupId: string;
  remark?: string;
  limitType: AccountLimitType;
  isBanned: boolean;
  proxy?: string;
  session: string;
};

export function accountEditorMode(account?: Pick<AccountActionSummary, "email">) {
  return account ? {
    title: `编辑账号 · ${account.email}`,
    submitLabel: "保存账号资料",
    successMessage: "账号资料已保存",
    showEmail: false,
    showLimitType: true,
    showProxy: false,
    sessionExtra: "完整显示且不做脱敏；内容没有变化时不会重复写入。",
  } : {
    title: "添加账号",
    submitLabel: "创建账号",
    successMessage: "账号已创建",
    showEmail: true,
    showLimitType: false,
    showProxy: true,
    sessionExtra: "可选；填写后将校验 JSON 和账号邮箱。",
  };
}

export function AccountEditorModal({
  account,
  open,
  onClose,
  onSaved,
}: {
  account?: AccountActionSummary;
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const productMessage = useProductMessage();
  const mode = accountEditorMode(account);
  const [form] = Form.useForm<AccountEditorValues>();
  const [groups, setGroups] = useState<Array<Pick<AccountGroupView, "id" | "name">>>([]);
  const [initialSession, setInitialSession] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    form.resetFields();
    setGroups(account ? [account.group] : []);
    setInitialSession(account ? undefined : "");
    form.setFieldsValue({
      email: "",
      groupId: account?.group.id,
      remark: account?.remark,
      limitType: account?.limitType ?? "unknown",
      isBanned: account?.isBanned ?? false,
      proxy: "",
      session: "",
    });
    const sessionRequest = account
      ? unifiedApi.accountSession(account.id).catch((reason) => {
          if (reason instanceof ApiError && reason.status === 404) return {};
          throw reason;
        })
      : Promise.resolve(undefined);
    void Promise.allSettled([unifiedApi.groups(), sessionRequest]).then((results) => {
      if (cancelled) return;
      const errors: string[] = [];
      if (results[0].status === "fulfilled") setGroups(results[0].value);
      else errors.push(`分组读取失败：${(results[0].reason as Error).message}`);
      if (account && results[1].status === "fulfilled") {
        const session = JSON.stringify(results[1].value, null, 2);
        setInitialSession(session);
        form.setFieldValue("session", session);
      } else if (account && results[1].status === "rejected") {
        errors.push(`Session 读取失败：${(results[1].reason as Error).message}`);
      }
      setError(errors.join("；"));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [account, form, open]);

  return (
    <ProductModal
      title={mode.title}
      open={open}
      onCancel={onClose}
      footer={(
        <Space>
          <Button onClick={onClose} disabled={saving}>取消</Button>
          <Button type="primary" loading={saving} disabled={loading} onClick={() => form.submit()}>
            {mode.submitLabel}
          </Button>
        </Space>
      )}
      width={760}
    >
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
      <Form<AccountEditorValues>
        form={form}
        layout="vertical"
        autoComplete="off"
        disabled={loading}
        className="account-action-form"
        onFinish={async (values) => {
          let parsedSession: Record<string, unknown> | undefined;
          const session = values.session?.trim() ?? "";
          const shouldParseSession = account
            ? initialSession !== undefined && values.session !== initialSession
            : Boolean(session);
          if (shouldParseSession) {
            try {
              parsedSession = parseSessionEditorInput(session);
            } catch (reason) {
              setError(
                reason instanceof SyntaxError
                  ? "Session 必须是有效的 JSON 对象"
                  : (reason as Error).message,
              );
              return;
            }
          }
          setSaving(true);
          setError("");
          try {
            if (account) {
              await unifiedApi.updateAccount(account.id, {
                groupId: values.groupId,
                remark: values.remark?.trim() || null,
                limitType: values.limitType,
                isBanned: values.isBanned,
                ...(parsedSession ? { session: parsedSession } : {}),
              });
            } else {
              await unifiedApi.createAccount({
                email: values.email?.trim() || undefined,
                groupId: values.groupId,
                remark: values.remark?.trim() || null,
                isBanned: values.isBanned,
                proxy: values.proxy?.trim() || undefined,
                ...(parsedSession ? { session: parsedSession } : {}),
              });
            }
            productMessage.success(mode.successMessage);
            await onSaved();
            onClose();
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        {mode.showEmail && <Form.Item
          name="email"
          label="邮箱"
          dependencies={["session"]}
          extra="未填写时从 Session 识别。"
          rules={[
            { type: "email", message: "请输入有效邮箱" },
            ({ getFieldValue }) => ({
              validator: async (_, value) => {
                if (String(value ?? "").trim() || String(getFieldValue("session") ?? "").trim()) return;
                throw new Error("邮箱和 Session 至少填写一项");
              },
            }),
          ]}
        >
          <Input autoComplete="off" />
        </Form.Item>}
        <div className="responsive-form-grid">
          <Form.Item name="groupId" label="分组" rules={[{ required: true, message: "请选择分组" }]}>
            <Select options={groups.map((group) => ({ value: group.id, label: group.name }))} />
          </Form.Item>
          {mode.showLimitType && <Form.Item name="limitType" label="限额类型" rules={[{ required: true, message: "请选择限额类型" }]}>
            <Select options={[
              { value: "unknown", label: "未知" },
              { value: "weekly", label: "周限" },
              { value: "monthly", label: "月限" },
            ]} />
          </Form.Item>}
        </div>
        <Form.Item name="remark" label="账号备注">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="isBanned" label="封号标记" valuePropName="checked">
          <Switch checkedChildren="已封号" unCheckedChildren="正常" />
        </Form.Item>
        {mode.showProxy && <Form.Item name="proxy" label="账号代理">
          <Input autoComplete="off" spellCheck={false} />
        </Form.Item>}
        <Form.Item
          name="session"
          label="Session JSON"
          extra={mode.sessionExtra}
        >
          <Input.TextArea
            aria-label="完整 ChatGPT Session JSON"
            className="raw-json account-session-editor"
            disabled={loading || (Boolean(account) && initialSession === undefined)}
            rows={15}
            wrap="soft"
          />
        </Form.Item>
      </Form>
    </ProductModal>
  );
}
