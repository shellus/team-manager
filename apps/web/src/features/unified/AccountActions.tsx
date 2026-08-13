import { useEffect, useState, type MouseEvent } from "react";
import { Alert, Button, Form, Input, Modal, Space, Tooltip, message } from "antd";
import type {
  AccountManagerOperationView,
  AccountManagerStateView,
  ResidentialProxyConfig,
} from "@team-manager/shared";
import { unifiedApi } from "../../unifiedApi.js";
import { ApiError } from "../../api.js";
import {
  shouldStopProfile,
  parseSessionEditorInput,
  type AccountActionModal,
  type AccountActionSummary,
} from "./accountActionsModel.js";
import { SubscriptionModal } from "./SubscriptionModal.js";

export function AccountActionButtons({
  account,
  profileStatus,
  onOpen,
}: {
  account: AccountActionSummary;
  profileStatus?: string;
  onOpen: (action: AccountActionModal) => void;
}) {
  const stopProfile = shouldStopProfile(
    profileStatus ?? account.profileStatus,
    account.hasRunningProfile,
  );
  const gamDisabled = !account.hasGamBinding;
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
      <Tooltip title={gamDisabled ? "请先绑定 GAM 账号引用" : undefined}>
        <span>
          <Button
            size="small"
            disabled={gamDisabled}
            onClick={(event) => {
              stopPropagation(event);
              onOpen("profile");
            }}
          >
            {stopProfile ? "停止" : "启动"}
          </Button>
        </span>
      </Tooltip>
      {actionButton("proxy", "换 IP", gamDisabled)}
      {actionButton("subscription", "开通", gamDisabled)}
      {actionButton("session", "编辑")}
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
      <ProfileModal
        account={account}
        open={action === "profile"}
        onClose={onClose}
        onChanged={onChanged}
      />
      <SubscriptionModal
        accountId={account.id}
        currentPlan={account.personalPlan}
        open={action === "subscription"}
        onClose={onClose}
        onChanged={onChanged}
        onOperationCreated={onOperationCreated}
      />
      <SessionEditorModal
        accountId={account.id}
        open={action === "session"}
        onClose={onClose}
        onSaved={onChanged}
      />
    </>
  );
}

function ProfileModal({
  account,
  open,
  onClose,
  onChanged,
}: {
  account: AccountActionSummary;
  open: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stopProfile = shouldStopProfile(
    account.profileStatus,
    account.hasRunningProfile,
  );
  const verb = stopProfile ? "停止" : "启动";
  return (
    <Modal
      title={`${verb} Profile`}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Alert
        type={stopProfile ? "warning" : "info"}
        showIcon
        message={`账号：${account.email}`}
        description={`当前状态：${account.profileStatus ?? (account.hasRunningProfile ? "运行中" : "已停止")}`}
      />
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
      <Button
        className="account-action-submit"
        type="primary"
        danger={stopProfile}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            if (stopProfile) await unifiedApi.stopProfile(account.id);
            else await unifiedApi.startProfile(account.id);
            message.success(`Profile 已${verb}`);
            await onChanged();
            onClose();
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        确认{verb}
      </Button>
    </Modal>
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
        message="修改完整住宅代理配置。SID、地区或线路条件变化后，GAM 将按新配置使用代理。"
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
        <div className="responsive-form-grid">
          <Form.Item name="sid" label="代理 SID" rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="country"
            label="国家"
            rules={[{ required: true, pattern: /^[A-Za-z]{2}$/ }]}
          >
            <Input maxLength={2} autoComplete="off" />
          </Form.Item>
          <Form.Item name="asn" label="ASN">
            <Input allowClear autoComplete="off" />
          </Form.Item>
          <Form.Item name="state" label="州/省">
            <Input allowClear autoComplete="off" />
          </Form.Item>
          <Form.Item name="city" label="城市">
            <Input allowClear autoComplete="off" />
          </Form.Item>
        </div>
        <Button type="primary" htmlType="submit" loading={saving}>
          保存代理配置
        </Button>
      </Form>
    </Modal>
  );
}

function SessionEditorModal({
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
  const [session, setSession] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    void unifiedApi
      .accountSession(accountId)
      .then((value) => setSession(JSON.stringify(value, null, 2)))
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 404) {
          setSession("{}");
          return;
        }
        setError((reason as Error).message);
      })
      .finally(() => setLoading(false));
  }, [accountId, open]);

  return (
    <Modal
      title="编辑 Session"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={760}
    >
      <Alert
        type="info"
        showIcon
        message="此处完整显示并保存 ChatGPT Session，不做脱敏。"
      />
      {error && <Alert className="modal-error" type="error" showIcon message={error} />}
      <Input.TextArea
        aria-label="完整 ChatGPT Session JSON"
        className="raw-json account-session-editor"
        autoSize={{ minRows: 14, maxRows: 28 }}
        disabled={loading}
        value={session}
        onChange={(event) => setSession(event.target.value)}
      />
      <Button
        type="primary"
        loading={saving}
        disabled={loading}
        onClick={async () => {
          let parsed: Record<string, unknown>;
          try {
            parsed = parseSessionEditorInput(session);
          } catch (reason) {
            setError(
              reason instanceof SyntaxError
                ? "Session 必须是有效的 JSON 对象"
                : (reason as Error).message,
            );
            return;
          }
          setSaving(true);
          setError("");
          try {
            await unifiedApi.updateAccountSession(accountId, parsed);
            message.success("Session 已保存");
            await onSaved();
            onClose();
          } catch (reason) {
            setError((reason as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        保存 Session
      </Button>
    </Modal>
  );
}
