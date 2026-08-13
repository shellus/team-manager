import { useEffect, useState, type MouseEvent } from "react";
import { Alert, Button, Form, Input, Modal, Select, Space, Tooltip, message } from "antd";
import type {
  AccountManagerOperationView,
  AccountProfileStatus,
  AccountManagerStateView,
  ResidentialProxyConfig,
} from "@team-manager/shared";
import { CHECKOUT_COUNTRY_CODES } from "@team-manager/shared";
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
  const asn = Form.useWatch("asn", form);
  const state = Form.useWatch("state", form);
  const city = Form.useWatch("city", form);

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
        <div className="responsive-form-grid">
          <Form.Item name="sid" label="代理 SID" rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="country"
            label="国家"
            rules={[{ required: true }]}
          >
            <Select showSearch optionFilterProp="label" options={CHECKOUT_COUNTRY_CODES.map(value => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="asn" label="ASN" rules={[{ validator: async (_, value) => { if (value && (state || city)) throw new Error("ASN 不能与州/省或城市同时使用"); } }]}>
            <Input allowClear disabled={Boolean(state || city)} autoComplete="off" placeholder={state || city ? "已使用地区定位" : "例如 AS7922"} />
          </Form.Item>
          <Form.Item name="state" label="州/省">
            <Input allowClear disabled={Boolean(asn)} autoComplete="off" placeholder={asn ? "已使用 ASN 定位" : undefined} />
          </Form.Item>
          <Form.Item name="city" label="城市" rules={[{ validator: async (_, value) => { if (value && !state) throw new Error("填写城市时必须同时填写州/省"); } }]}>
            <Input allowClear disabled={Boolean(asn)} autoComplete="off" placeholder={asn ? "已使用 ASN 定位" : undefined} />
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
