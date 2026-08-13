import type { NotificationDeliveryView } from "@team-manager/shared";

export interface WorkspaceSettingsFormValues {
  name?: string;
  defaultSeat?: "default" | "usage_based";
  workspaceReferralsEnabled?: boolean;
  autoAcceptRequests?: boolean;
  personalAccessTokensEnabled?: boolean;
  codexDeviceCodeAuthEnabled?: boolean;
  codexRemoteControlEnabled?: boolean;
  automaticReloadEnabled?: boolean;
  codexLocalAccessEnabled?: boolean;
}

export interface AutomaticReloadDetails {
  threshold?: string;
  target?: string;
  monthlyLimit?: string;
  monthlyRemaining?: string;
  immediateStatus?: string;
  immediateMessage?: string;
}

export function workspaceSettingsFormValues(
  payload: Record<string, unknown>,
  name?: string,
): WorkspaceSettingsFormValues {
  const beta = record(payload.beta_settings);
  const permissions = record(payload.permissions);
  const automaticReload =
    record(payload.automatic_reload) ??
    record(payload.auto_top_up) ??
    record(payload.automatic_reload_settings);
  return {
    name,
    defaultSeat: seat(payload.default_seat_type),
    workspaceReferralsEnabled: bool(payload.workspace_referrals_enabled),
    autoAcceptRequests: bool(payload.auto_accept_requests),
    personalAccessTokensEnabled:
      bool(payload.personal_access_tokens) ?? bool(beta?.personal_access_tokens) ??
      bool(permissions?.personal_access_tokens),
    codexDeviceCodeAuthEnabled: bool(payload.codex_device_code_auth) ?? bool(beta?.codex_device_code_auth),
    codexRemoteControlEnabled: bool(payload.codex_remote_control) ?? bool(beta?.codex_remote_control),
    codexLocalAccessEnabled:
      bool(payload.wham_local_access) ?? bool(beta?.wham_local_access),
    automaticReloadEnabled:
      bool(payload.automatic_reload_enabled) ??
      bool(automaticReload?.is_enabled),
  };
}

export function workspaceSettingsPatch(values: WorkspaceSettingsFormValues, initial: WorkspaceSettingsFormValues = {}) {
  const keys: Array<Exclude<keyof WorkspaceSettingsFormValues, "name">> = [
    "defaultSeat",
    "workspaceReferralsEnabled",
    "autoAcceptRequests",
    "personalAccessTokensEnabled",
    "codexDeviceCodeAuthEnabled",
    "codexRemoteControlEnabled",
    "automaticReloadEnabled",
  ];
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== undefined && values[key] !== initial[key])
      .map((key) => [key, values[key]]),
  );
}

export function automaticReloadDetails(payload:Record<string,unknown>):AutomaticReloadDetails{
  const value=record(payload.automatic_reload)??record(payload.auto_top_up)??record(payload.automatic_reload_settings);
  return {threshold:text(value?.recharge_threshold),target:text(value?.recharge_target),monthlyLimit:text(value?.recharge_monthly_limit),monthlyRemaining:text(value?.recharge_monthly_remaining),immediateStatus:text(value?.immediate_top_up_status),immediateMessage:text(value?.immediate_top_up_message)};
}

export function notificationDeliveryPresentation(
  delivery: NotificationDeliveryView,
) {
  const attempts = `${delivery.attemptCount}/${delivery.maxAttempts}`;
  if (delivery.status === "delivered") {
    return {
      label: "已投递",
      color: "green",
      detail: `尝试 ${attempts}`,
      canRetry: false,
    };
  }
  if (delivery.status === "retrying") {
    const canRetry = delivery.attemptCount < delivery.maxAttempts;
    return {
      label: canRetry ? "等待重试" : "重试已耗尽",
      color: canRetry ? "orange" : "red",
      detail: canRetry
        ? `尝试 ${attempts}${delivery.nextRetryAt ? `，下次 ${delivery.nextRetryAt}` : ""}`
        : `已达到最大尝试次数 ${attempts}`,
      canRetry,
    };
  }
  if (delivery.status === "exhausted") {
    return {
      label: "重试已耗尽",
      color: "red",
      detail: `已达到最大尝试次数 ${attempts}`,
      canRetry: false,
    };
  }
  if (delivery.status === "failed") {
    const canRetry = delivery.attemptCount < delivery.maxAttempts;
    return {
      label: canRetry ? "投递失败" : "重试已耗尽",
      color: "red",
      detail: canRetry ? `尝试 ${attempts}` : `已达到最大尝试次数 ${attempts}`,
      canRetry,
    };
  }
  return {
    label: delivery.status,
    color: "default",
    detail: `尝试 ${attempts}`,
    canRetry: false,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function text(value:unknown){return typeof value==='string'&&value.trim()?value.trim():undefined;}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function seat(value: unknown): "default" | "usage_based" | undefined {
  return value === "default" || value === "usage_based" ? value : undefined;
}
