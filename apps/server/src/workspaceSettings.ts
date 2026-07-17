import type { SeatType } from '@team-manager/shared';

export interface WorkspaceSettingsCache {
  defaultSeat?: SeatType;
  defaultSeatCachedAt?: number;
  workspaceReferralsEnabled?: boolean;
  workspaceReferralsEnabledVisible?: boolean;
  workspaceReferralsEnabledCachedAt?: number;
  personalAccessTokensEnabled?: boolean;
  personalAccessTokensCachedAt?: number;
  codexLocalAccessEnabled?: boolean;
  codexLocalAccessCachedAt?: number;
  codexDeviceCodeAuthEnabled?: boolean;
  codexDeviceCodeAuthCachedAt?: number;
  codexRemoteControlEnabled?: boolean;
  codexRemoteControlCachedAt?: number;
  lastRefreshAt?: number;
  lastError?: string;
}

export interface WorkspaceSettingsFallback {
  defaultSeat?: SeatType;
  workspaceReferralsEnabled?: boolean;
  personalAccessTokensEnabled?: boolean;
  codexDeviceCodeAuthEnabled?: boolean;
  codexRemoteControlEnabled?: boolean;
}

export function workspaceSettingsFromCache(account: WorkspaceSettingsCache): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (account.defaultSeat) settings.default_seat_type = account.defaultSeat;
  if (typeof account.workspaceReferralsEnabled === 'boolean') {
    settings.workspace_referrals_enabled = account.workspaceReferralsEnabled;
  }
  if (typeof account.workspaceReferralsEnabledVisible === 'boolean') {
    settings.workspace_referrals_enabled_visible = account.workspaceReferralsEnabledVisible;
  }
  if (typeof account.personalAccessTokensEnabled === 'boolean') {
    settings.personal_access_tokens = account.personalAccessTokensEnabled;
  }
  if (typeof account.codexLocalAccessEnabled === 'boolean') {
    settings.wham_local_access = account.codexLocalAccessEnabled;
  }
  if (typeof account.codexDeviceCodeAuthEnabled === 'boolean') {
    settings.codex_device_code_auth = account.codexDeviceCodeAuthEnabled;
  }
  if (typeof account.codexRemoteControlEnabled === 'boolean') {
    settings.codex_remote_control = account.codexRemoteControlEnabled;
  }
  return settings;
}

export function workspaceSettingsPatchFromResponse(
  settings: Record<string, unknown>,
  now: number,
  fallback: WorkspaceSettingsFallback = {}
): WorkspaceSettingsCache {
  const patch: WorkspaceSettingsCache = {
    lastRefreshAt: now,
    lastError: undefined
  };

  const defaultSeat = settings.default_seat_type ?? fallback.defaultSeat;
  if (defaultSeat === 'default' || defaultSeat === 'usage_based') {
    patch.defaultSeat = defaultSeat;
    patch.defaultSeatCachedAt = now;
  }

  const workspaceReferralsEnabled =
    settings.workspace_referrals_enabled ?? fallback.workspaceReferralsEnabled;
  if (typeof workspaceReferralsEnabled === 'boolean') {
    patch.workspaceReferralsEnabled = workspaceReferralsEnabled;
    patch.workspaceReferralsEnabledCachedAt = now;
  }

  const workspaceReferralsEnabledVisible = settings.workspace_referrals_enabled_visible;
  if (typeof workspaceReferralsEnabledVisible === 'boolean') {
    patch.workspaceReferralsEnabledVisible = workspaceReferralsEnabledVisible;
  }

  const permissions = recordValue(settings.permissions);
  const betaSettings = recordValue(settings.beta_settings);
  const personalAccessTokensEnabled =
    settings.personal_access_tokens ??
    betaSettings?.personal_access_tokens ??
    permissions?.personal_access_tokens ??
    fallback.personalAccessTokensEnabled;
  if (typeof personalAccessTokensEnabled === 'boolean') {
    patch.personalAccessTokensEnabled = personalAccessTokensEnabled;
    patch.personalAccessTokensCachedAt = now;
  }

  const codexLocalAccessEnabled = settings.wham_local_access ?? betaSettings?.wham_local_access;
  if (typeof codexLocalAccessEnabled === 'boolean') {
    patch.codexLocalAccessEnabled = codexLocalAccessEnabled;
    patch.codexLocalAccessCachedAt = now;
  }

  const codexDeviceCodeAuthEnabled =
    settings.codex_device_code_auth ??
    betaSettings?.codex_device_code_auth ??
    fallback.codexDeviceCodeAuthEnabled;
  if (typeof codexDeviceCodeAuthEnabled === 'boolean') {
    patch.codexDeviceCodeAuthEnabled = codexDeviceCodeAuthEnabled;
    patch.codexDeviceCodeAuthCachedAt = now;
  }

  const codexRemoteControlEnabled =
    settings.codex_remote_control ??
    betaSettings?.codex_remote_control ??
    fallback.codexRemoteControlEnabled;
  if (typeof codexRemoteControlEnabled === 'boolean') {
    patch.codexRemoteControlEnabled = codexRemoteControlEnabled;
    patch.codexRemoteControlCachedAt = now;
  }

  return patch;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
