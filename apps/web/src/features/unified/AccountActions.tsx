import { useEffect, useState, type MouseEvent } from "react";
import { Alert, Button, Form, Input, Modal, Select, Space, Switch, Tooltip, message } from "antd";
import type {
  AccountGroupView,
  AccountLimitType,
  AccountManagerOperationView,
  AccountProfileStatus,
  AccountManagerStateView,
  ResidentialProxyConfig,
} from "@team-manager/shared";
import { ProxyConfigurationFields } from "../../components/ProxyConfigurationFields.js";
import { unifiedApi } from "../../unifiedApi.js";
import { ApiError } from "../../api.js";
import {
  executeProfileAction,
  profileAction,
  parseSessionEditorInput,
  type AccountActionModal,
  type AccountActionSummary,
} from "./accountActionsModel.js";
import { SubscriptionModal } from "./SubscriptionModal.js";

export function AccountActionButtons({
  account,
  profileStatus,
  onOpen,
  onChanged,
}: {
  account: AccountActionSummary;
  profileStatus?: AccountProfileStatus;
  onOpen: (action: AccountActionModal) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [profileBusy, setProfileBusy] = useState(false);
  const currentProfileStatus = profileStatus ?? account.profileStatus;
  const nextProfileAction = profileAction(
    currentProfileStatus,
    account.hasRunningProfile,
  );
  const gamDisabled = !account.hasGamBinding;
  const profilePending = nextProfileAction === "pending";
  const stopPropagation = (event: MouseEvent<HTMLElement>) =>
    event.stopPropagation();

  const actionButton = (
    action: AccountActionModal,
    label: string,
    disabled = false,
  ) => (
    <Tooltip title={disabled ? "请先绑定 GAM 账号引用" : undefined}>
      <span>
        <Button
          size="small"
          disabled={disabled}
          onClick={(event) => {
            stopPropagation(event);
            onOpen(action);
          }}
        >
          {label}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Space
      wrap
      size={[6, 6]}
      className="account-action-buttons"
      onClick={stopPropagation}
    >
      <Tooltip
        title={
          gamDisabled
            ? "请先绑定 GAM 账号引用"
            : profilePending
              ? "Profile 状态正在切换，请稍后再操作"
              : undefined
        }
      >
        <span>
          <Button
            size="small"
            loading={profileBusy}
            disabled={gamDisabled || profilePending || profileBusy}
            onClick={async (event) => {
              stopPropagation(event);
              setProfileBusy(true);
              try {
                if (nextProfileAction === "pending") return;
                await executeProfileAction(account.id, nextProfileAction, {
                  start: unifiedApi.startProfile,
                  stop: unifiedApi.stopProfile,
                });
                message.success(`Profile 已${nextProfileAction === "stop" ? "停止" : "启动"}`);
                await onChanged();
              } catch (reason) {
                message.error((reason as Error).message);
              } finally {
                setProfileBusy(false);
              }
            }}
          >
            {profileBusy
              ? nextProfileAction === "stop" ? "停止中" : "启动中"
              : profilePending
              ? currentProfileStatus === "stopping"
                ? "停止中"
                : "启动中"
              : nextProfileAction === "stop"
                ? "停止"
                : "启动"}
          </Button>
        </span>
      </Tooltip>
      {actionButton("proxy", "换 IP", gamDisabled)}
      {actionButton("subscription", "开通", gamDisabled)}
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
  onOperationCreated?: (operation: AccountManagerOperationView) => void;
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
  const [form] = Form.useForm<ResidentialProxyConfig>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    void unifiedApi
      .accountManagerState(accountId)
      .then((state: AccountManagerStateView) => {
        form.setFieldsValue(
          state.proxy ?? { sid: "", country: "US", asn: null, state: null, city: null },
        );
      })
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setLoading(false));
  }, [accountId, form, open]);

  return (
    <Modal
      title="换 IP"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={640}
    >
      <Alert
        type="info"
        showIcon
        message="修改 SID 会更换住宅代理的粘性会话并获得新 IP；ASN 与州/省、城市是两种互斥定位方式。"
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
            await unifiedApi.configureProxy(accountId, {
              sid: values.sid,
              country: values.country.toUpperCase(),
              asn: values.asn || null,
              state: values.state || null,
              city: values.city || null,
            });
            message.success("代理配置已保存");
            await onSaved();
            onClose();
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <ProxyConfigurationFields form={form} />
        <Button type="primary" htmlType="submit" loading={saving}>
          保存代理配置
        </Button>
      </Form>
    </Modal>
  );
}

type AccountEditorValues = {
  groupId: string;
  remark?: string;
  limitType: AccountLimitType;
  isBanned: boolean;
  session: string;
};

function AccountEditorModal({
  account,
  open,
  onClose,
  onSaved,
}: {
  account: AccountActionSummary;
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
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
    setGroups([account.group]);
    setInitialSession(undefined);
    form.setFieldsValue({
      groupId: account.group.id,
      remark: account.remark,
      limitType: account.limitType,
      isBanned: account.isBanned,
      session: "",
    });
    const sessionRequest = unifiedApi.accountSession(account.id).catch((reason) => {
      if (reason instanceof ApiError && reason.status === 404) return {};
      throw reason;
    });
    void Promise.allSettled([unifiedApi.groups(), sessionRequest]).then((results) => {
      if (cancelled) return;
      const errors: string[] = [];
      if (results[0].status === "fulfilled") setGroups(results[0].value);
      else errors.push(`分组读取失败：${(results[0].reason as Error).message}`);
      if (results[1].status === "fulfilled") {
        const session = JSON.stringify(results[1].value, null, 2);
        setInitialSession(session);
        form.setFieldValue("session", session);
      } else {
        errors.push(`Session 读取失败：${(results[1].reason as Error).message}`);
      }
      setError(errors.join("；"));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [account, form, open]);

  return (
    <Modal
      title={`编辑账号 · ${account.email}`}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={760}
    >
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
      <Form<AccountEditorValues>
        form={form}
        layout="vertical"
        disabled={loading}
        className="account-action-form"
        onFinish={async (values) => {
          let parsedSession: Record<string, unknown> | undefined;
          if (initialSession !== undefined && values.session !== initialSession) {
            try {
              parsedSession = parseSessionEditorInput(values.session);
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
            await unifiedApi.updateAccount(account.id, {
              groupId: values.groupId,
              remark: values.remark?.trim() || null,
              limitType: values.limitType,
              isBanned: values.isBanned,
              ...(parsedSession ? { session: parsedSession } : {}),
            });
            message.success("账号资料已保存");
            await onSaved();
            onClose();
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="responsive-form-grid">
          <Form.Item name="groupId" label="分组" rules={[{ required: true, message: "请选择分组" }]}>
            <Select options={groups.map((group) => ({ value: group.id, label: group.name }))} />
          </Form.Item>
          <Form.Item name="limitType" label="限额类型" rules={[{ required: true, message: "请选择限额类型" }]}>
            <Select options={[
              { value: "unknown", label: "未知" },
              { value: "weekly", label: "周限" },
              { value: "monthly", label: "月限" },
            ]} />
          </Form.Item>
        </div>
        <Form.Item name="remark" label="账号备注">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="isBanned" label="封号标记" valuePropName="checked">
          <Switch checkedChildren="已封号" unCheckedChildren="正常" />
        </Form.Item>
        <Form.Item
          name="session"
          label="Session JSON"
          extra="完整显示且不做脱敏；内容没有变化时不会重复写入。"
        >
          <Input.TextArea
            aria-label="完整 ChatGPT Session JSON"
            className="raw-json account-session-editor"
            autoSize={{ minRows: 14, maxRows: 28 }}
            disabled={loading || initialSession === undefined}
            wrap="soft"
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} disabled={loading}>
          保存账号资料
        </Button>
      </Form>
    </Modal>
  );
}
