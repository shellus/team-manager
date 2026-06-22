import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type {
  AccountView,
  CodexAuthRuntimeStatus,
  CodexQuotaSnapshot,
  SubaccountAuthLog,
  SubaccountCodexCredentialView,
  SubaccountStatus,
  SubaccountTeamLink,
  SubaccountView
} from '@team-manager/shared';
import { apiClient } from './api.js';
import { SessionImportDialog } from './SessionImportDialog.js';
import { CredentialImportDialog } from './CredentialImportDialog.js';
import { LocalProfileDialog } from './LocalProfileDialog.js';
import { WorkspaceListCard } from './WorkspaceListCard.js';

const STATUS_LABEL: Record<SubaccountStatus, string> = {
  empty: '未录入',
  session_ready: 'Session 可用',
  codex_auth_pending: '授权中',
  codex_ready: 'Codex 可用',
  verification_required: '待验证',
  account_locked: '账号锁定',
  error: '异常'
};

const TEAM_LINK_STATUS_LABEL = {
  member: '已在 Team',
  invited: '邀请中',
  removed: '未找到',
  unknown: '未确认'
} as const;

const TEAM_LINK_STATUS_ORDER = {
  member: 0,
  invited: 1,
  unknown: 2,
  removed: 3
} as const;

type CredentialTeamRow = {
  key: string;
  workspaceId: string;
  link?: SubaccountTeamLink;
  credential?: SubaccountCodexCredentialView;
  account?: AccountView;
};

type AuthProgressStepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'error';

type AuthProgressStep = {
  id: string;
  label: string;
  detail: string;
  phases: string[];
  optional?: boolean;
};

type AuthProgress = {
  logs: SubaccountAuthLog[];
  target?: string;
  running: boolean;
  completed: boolean;
  failed: boolean;
};

const AUTH_PROGRESS_STEPS: AuthProgressStep[] = [
  {
    id: 'start',
    label: '启动',
    detail: '创建授权会话',
    phases: ['codex_auto_auth_start']
  },
  {
    id: 'email',
    label: '邮箱',
    detail: '发送并验证 OTP',
    phases: [
      'email_otp_already_requested',
      'email_otp_send_loop',
      'passwordless_send_otp',
      'passwordless_validate_otp',
      'email_otp_validate',
      'email_otp_done',
      'email_otp_poll_failed',
      'email_otp_rejected'
    ],
    optional: true
  },
  {
    id: 'phone',
    label: '手机',
    detail: '绑定或二次验证',
    phases: [
      'phone_otp_select_channel_loop',
      'phone_slot_selected',
      'phone_otp_done',
      'phone_send_rejected',
      'phone_send_exhausted',
      'phone_pool_empty',
      'phone_otp_poll_failed',
      'phone_otp_rejected',
      'bound_phone_slot_selected',
      'bound_phone_otp_done',
      'bound_phone_pool_empty',
      'bound_phone_ambiguous',
      'bound_phone_hint_missing',
      'bound_phone_not_in_pool'
    ],
    optional: true
  },
  {
    id: 'challenge',
    label: '页面校验',
    detail: '处理 auth challenge',
    phases: [
      'auth_challenge_required',
      'human_verification_solver_start',
      'human_verification_solver_failed',
      'human_verification_solver_no_json_state',
      'human_verification_solver_continue_failed',
      'human_verification_solver_empty_state',
      'flaresolverr_authorize',
      'account_locked'
    ],
    optional: true
  },
  {
    id: 'workspace',
    label: 'Team',
    detail: '选择目标 workspace',
    phases: [
      'organization_select',
      'workspace_select',
      'account_select',
      'follow_continue_1',
      'follow_continue_2',
      'follow_continue_3',
      'follow_continue_4',
      'follow_continue_5',
      'follow_continue_6',
      'follow_continue_7',
      'follow_continue_8'
    ],
    optional: true
  },
  {
    id: 'token',
    label: '凭证',
    detail: '换取并保存 token',
    phases: ['oauth_token_exchange', 'codex_auto_auth_complete']
  }
];

const AUTH_PHASE_LABEL: Record<string, string> = {
  codex_auto_auth_start: '启动自动授权',
  codex_auto_auth_complete: '自动授权完成',
  email_otp_already_requested: '邮箱 OTP 已请求',
  email_otp_send_loop: '等待邮箱 OTP',
  passwordless_send_otp: '发送邮箱 OTP',
  passwordless_validate_otp: '验证邮箱 OTP',
  email_otp_validate: '验证邮箱 OTP',
  email_otp_done: '邮箱验证完成',
  email_otp_poll_failed: '邮箱 OTP 读取失败',
  email_otp_rejected: '邮箱 OTP 被拒绝',
  phone_otp_select_channel_loop: '选择短信通道',
  phone_slot_selected: '已选择手机号',
  phone_otp_done: '短信验证完成',
  phone_send_rejected: '短信发送被拒绝',
  phone_send_exhausted: '短信号码已用尽',
  phone_pool_empty: '手机号池为空',
  phone_otp_poll_failed: '短信 OTP 读取失败',
  phone_otp_rejected: '短信 OTP 被拒绝',
  bound_phone_slot_selected: '已匹配绑定手机号',
  bound_phone_otp_done: '绑定手机号验证完成',
  bound_phone_pool_empty: '绑定手机号池为空',
  bound_phone_ambiguous: '绑定手机号不明确',
  bound_phone_hint_missing: '缺少绑定手机号提示',
  bound_phone_not_in_pool: '绑定手机号不在号池',
  auth_challenge_required: '需要页面校验',
  human_verification_solver_start: '开始页面校验',
  human_verification_solver_failed: '页面校验失败',
  human_verification_solver_no_json_state: '页面校验状态缺失',
  human_verification_solver_continue_failed: '页面校验继续失败',
  human_verification_solver_empty_state: '页面校验状态为空',
  flaresolverr_authorize: '授权页 clearance',
  account_locked: '账号锁定',
  organization_select: '选择组织',
  workspace_select: '选择 Team workspace',
  account_select: '选择账号',
  follow_continue_1: '跟随授权跳转 1',
  follow_continue_2: '跟随授权跳转 2',
  follow_continue_3: '跟随授权跳转 3',
  follow_continue_4: '跟随授权跳转 4',
  follow_continue_5: '跟随授权跳转 5',
  follow_continue_6: '跟随授权跳转 6',
  follow_continue_7: '跟随授权跳转 7',
  follow_continue_8: '跟随授权跳转 8',
  oauth_token_exchange: '换取 Codex token',
  codex_credential_delete: '删除 Codex 凭证',
  codex_credential_import: '导入 Codex 凭证',
  codex_auth_start: '创建手动授权 URL',
  codex_auth_callback: '提交手动授权回调',
  quota_refresh: '刷新额度',
  session_import: '录入子号 Session',
  local_profile_update: '更新本地资料',
  subaccount_registration_complete: '自动注册完成',
  team_link_sync: '同步 Team 关联'
};

const AUTO_AUTH_PHASES = new Set(AUTH_PROGRESS_STEPS.flatMap((step) => step.phases));

function formatTime(value?: number | string) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function shortError(error: string) {
  return error.length > 120 ? `${error.slice(0, 120)}...` : error;
}

function formatRelativeTime(value?: number) {
  if (!value) return '暂无';
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function targetKey(prefix: string, accountId?: string) {
  return `${prefix}-${accountId || 'default'}`;
}

function quotaLabel(credential?: SubaccountCodexCredentialView) {
  if (!credential?.lastQuota) return '暂无额度';
  if (credential.lastQuota.status !== 'success') return credential.lastQuota.status === 'error' ? '查询异常' : '暂无额度';
  const primary = credential.lastQuota.windows[0];
  return primary?.usedPercent === null || primary?.usedPercent === undefined ? '额度可用' : `${primary.usedPercent}%`;
}

function runtimeCapabilityClass(ready: boolean | undefined) {
  if (ready === undefined) return 'unknown';
  return ready ? 'ready' : 'missing';
}

function logData(log: SubaccountAuthLog): Record<string, unknown> {
  return log.data && typeof log.data === 'object' ? (log.data as Record<string, unknown>) : {};
}

function logTargetAccountId(log: SubaccountAuthLog): string | undefined {
  const data = logData(log);
  const target = data.targetChatgptAccountId ?? data.accountId;
  return typeof target === 'string' && target.trim() ? target.trim() : undefined;
}

function isFailureLog(log: SubaccountAuthLog) {
  return log.status === 'error' || log.status === 'account_locked' || log.status === 'verification_required';
}

function isAutoAuthLog(log: SubaccountAuthLog) {
  return log.phase === 'codex_auto_auth_start' || log.phase === 'codex_auto_auth_complete' || AUTO_AUTH_PHASES.has(log.phase);
}

function buildAuthProgress(logs: SubaccountAuthLog[], runningTarget: string): AuthProgress {
  const target = runningTarget && runningTarget !== 'default' ? runningTarget : undefined;
  const autoLogs = logs.filter((log) => isAutoAuthLog(log));
  const scopedLogs = target
    ? autoLogs.filter((log) => logTargetAccountId(log) === target)
    : autoLogs;
  const latestStart = scopedLogs.find((log) => log.phase === 'codex_auto_auth_start');
  const startAt = latestStart?.createdAt ?? scopedLogs[scopedLogs.length - 1]?.createdAt;
  const cycleLogs = startAt
    ? scopedLogs
        .filter((log) => log.createdAt >= startAt)
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];
  const completed = cycleLogs.some((log) => log.phase === 'codex_auto_auth_complete' && log.status === 'codex_ready');
  const failed = cycleLogs.some(isFailureLog);
  return {
    logs: cycleLogs,
    target: target ?? cycleLogs.map(logTargetAccountId).find(Boolean),
    running: Boolean(runningTarget),
    completed,
    failed
  };
}

function authStepStatus(step: AuthProgressStep, index: number, progress: AuthProgress): AuthProgressStepStatus {
  const stepLogs = progress.logs.filter((log) => step.phases.includes(log.phase));
  if (stepLogs.some(isFailureLog)) return 'error';
  if (stepLogs.length > 0) return 'done';
  const laterHasLogs = AUTH_PROGRESS_STEPS.slice(index + 1).some((later) =>
    progress.logs.some((log) => later.phases.includes(log.phase))
  );
  if ((progress.completed || laterHasLogs) && step.optional) return 'skipped';
  const firstPendingIndex = AUTH_PROGRESS_STEPS.findIndex((candidate, candidateIndex) => {
    const candidateLogs = progress.logs.filter((log) => candidate.phases.includes(log.phase));
    if (candidateLogs.length > 0) return false;
    const candidateLaterHasLogs = AUTH_PROGRESS_STEPS.slice(candidateIndex + 1).some((later) =>
      progress.logs.some((log) => later.phases.includes(log.phase))
    );
    return !((progress.completed || candidateLaterHasLogs) && candidate.optional);
  });
  if (progress.running && firstPendingIndex >= 0 && index === firstPendingIndex) return 'active';
  return 'pending';
}

function phaseLabel(phase: string) {
  return AUTH_PHASE_LABEL[phase] ?? phase.replace(/_/g, ' ');
}

function logMeta(log: SubaccountAuthLog) {
  const data = logData(log);
  const httpStatus = typeof data.httpStatus === 'number' ? `HTTP ${data.httpStatus}` : '';
  const pageType = typeof data.pageType === 'string' && data.pageType ? data.pageType : '';
  return [log.status, httpStatus, pageType].filter(Boolean).join(' · ');
}

function authStepStatusText(status: AuthProgressStepStatus) {
  if (status === 'done') return '完成';
  if (status === 'active') return '进行中';
  if (status === 'skipped') return '未触发';
  if (status === 'error') return '异常';
  return '等待';
}

export function SubaccountPanel({ accounts }: { accounts: AccountView[] }) {
  const removeDialogTitleId = useId();
  const [subaccounts, setSubaccounts] = useState<SubaccountView[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false);
  const [editingSubaccount, setEditingSubaccount] = useState<SubaccountView | null>(null);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [credentialJson, setCredentialJson] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<CodexAuthRuntimeStatus | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [authSession, setAuthSession] = useState<{
    sessionId: string;
    authUrl: string;
    expiresAt: number;
    targetChatgptAccountId?: string;
    targetLabel?: string;
  } | null>(null);
  const [quota, setQuota] = useState<CodexQuotaSnapshot | null>(null);
  const [logs, setLogs] = useState<SubaccountAuthLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState('');
  const [confirmCredentialDeleteKey, setConfirmCredentialDeleteKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selected = useMemo(
    () => subaccounts.find((subaccount) => subaccount.id === selectedId) ?? subaccounts[0] ?? null,
    [selectedId, subaccounts]
  );
  const removingSubaccount = useMemo(
    () => subaccounts.find((subaccount) => subaccount.id === confirmRemoveId) ?? null,
    [confirmRemoveId, subaccounts]
  );
  const removingSubaccountBusy = removingSubaccount ? busy === `remove-${removingSubaccount.id}` : false;
  const parentAccountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  );
  const parentAccountByWorkspaceId = useMemo(
    () => new Map(accounts.map((account) => [account.accountId, account])),
    [accounts]
  );
  const accountTeamLabel = useCallback((account: AccountView | undefined, fallback: string) => {
    if (!account) return fallback;
    return account.note || account.workspaceName || account.label;
  }, []);
  const linkLabel = useCallback(
    (link: SubaccountTeamLink) => {
      const account = parentAccountById.get(link.accountId);
      return accountTeamLabel(account, link.accountId);
    },
    [accountTeamLabel, parentAccountById]
  );
  const teamLinks = useMemo(
    () =>
      [...(selected?.teamLinks ?? [])].sort(
        (a, b) =>
          TEAM_LINK_STATUS_ORDER[a.status] - TEAM_LINK_STATUS_ORDER[b.status] ||
          linkLabel(a).localeCompare(linkLabel(b))
      ),
    [linkLabel, selected?.teamLinks]
  );
  const memberLinkCount = teamLinks.filter((link) => link.status === 'member').length;
  const invitedLinkCount = teamLinks.filter((link) => link.status === 'invited').length;
  const teamLinksSyncedAt = teamLinks.reduce<number | undefined>(
    (latest, link) => (latest ? Math.max(latest, link.updatedAt) : link.updatedAt),
    undefined
  );
  const credentialByAccountId = useMemo(
    () => new Map((selected?.codexCredentials ?? []).map((credential) => [credential.accountId, credential])),
    [selected?.codexCredentials]
  );
  const credentialTeamRows = useMemo<CredentialTeamRow[]>(() => {
    const rows: CredentialTeamRow[] = teamLinks.map((link) => {
      const account = parentAccountById.get(link.accountId);
      const workspaceId = account?.accountId ?? '';
      return {
        key: `link-${link.accountId}`,
        workspaceId,
        link,
        account,
        credential: workspaceId ? credentialByAccountId.get(workspaceId) : undefined
      };
    });
    const linkedWorkspaceIds = new Set(rows.map((row) => row.workspaceId).filter(Boolean));
    for (const credential of selected?.codexCredentials ?? []) {
      if (linkedWorkspaceIds.has(credential.accountId)) continue;
      const account = parentAccountByWorkspaceId.get(credential.accountId);
      rows.push({
        key: `credential-${credential.accountId}`,
        workspaceId: credential.accountId,
        account,
        credential
      });
    }
    return rows;
  }, [credentialByAccountId, parentAccountById, parentAccountByWorkspaceId, selected?.codexCredentials, teamLinks]);
  const credentialCount = selected?.codexCredentials.length ?? 0;
  const quotaCacheCount = selected?.codexCredentials.filter((credential) => credential.lastQuotaAt).length ?? 0;
  const latestAuthCredential = useMemo(
    () => [...(selected?.codexCredentials ?? [])].sort((a, b) => (b.lastAuthAt ?? 0) - (a.lastAuthAt ?? 0))[0],
    [selected?.codexCredentials]
  );
  const latestQuotaCredential = useMemo(
    () => [...(selected?.codexCredentials ?? [])].sort((a, b) => (b.lastQuotaAt ?? 0) - (a.lastQuotaAt ?? 0))[0],
    [selected?.codexCredentials]
  );
  const autoAuthBusyTarget = busy.startsWith('codex-auto-') ? busy.slice('codex-auto-'.length) : '';
  const authProgress = useMemo(
    () => buildAuthProgress(logs, autoAuthBusyTarget),
    [autoAuthBusyTarget, logs]
  );
  const authProgressTargetLabel = useMemo(() => {
    const target = authProgress.target;
    if (!target) return selected ? selected.label : '当前子号';
    const row = credentialTeamRows.find((item) => item.workspaceId === target || item.credential?.accountId === target);
    if (!row) return target;
    return row.link ? linkLabel(row.link) : accountTeamLabel(row.account, target);
  }, [accountTeamLabel, authProgress.target, credentialTeamRows, linkLabel, selected]);

  const mergeSubaccount = useCallback((updated: SubaccountView) => {
    setSubaccounts((current) => {
      const exists = current.some((item) => item.id === updated.id);
      const next = exists
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...current];
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
    setSelectedId(updated.id);
  }, []);

  const loadLogs = useCallback(async (id: string) => {
    setLogs(await apiClient.listSubaccountLogs(id));
  }, []);

  const loadRuntimeStatus = useCallback(async () => {
    setRuntimeLoading(true);
    try {
      setRuntimeStatus(await apiClient.getCodexAuthRuntimeStatus());
    } catch (e) {
      setRuntimeStatus({
        workerConfigured: false,
        workerReachable: false,
        codexAutoAuth: false,
        subaccountRegistration: false,
        flaresolverr: false,
        gongxiMail: false,
        phoneOtp: false,
        error: (e as Error).message
      });
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const items = await apiClient.listSubaccounts();
      setSubaccounts(items);
      setSelectedId((current) => current || items[0]?.id || '');
      if (items[0]?.id) await loadLogs(items[0].id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadLogs]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadRuntimeStatus();
  }, [loadRuntimeStatus]);

  useEffect(() => {
    if (!removingSubaccount) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !removingSubaccountBusy) setConfirmRemoveId('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [removingSubaccount, removingSubaccountBusy]);

  useEffect(() => {
    setQuota(null);
    setCredentialJson('');
    setAuthSession(null);
    setCallbackUrl('');
    setNotice('');
    setConfirmRemoveId('');
    setConfirmCredentialDeleteKey('');
    if (selected?.id) {
      loadLogs(selected.id).catch((e) => setError((e as Error).message));
    } else {
      setLogs([]);
    }
  }, [selected?.id, loadLogs]);

  useEffect(() => {
    if (!selected?.id || !autoAuthBusyTarget) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const nextLogs = await apiClient.listSubaccountLogs(selected.id);
        if (!cancelled) setLogs(nextLogs);
      } catch {
        // 主自动授权请求负责暴露错误，轮询失败不覆盖页面状态。
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 2000);
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [autoAuthBusyTarget, selected?.id]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      if (selected?.id) await loadLogs(selected.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const importSession = async (payload: Record<string, unknown>) => {
    setError('');
    setNotice('');
    const added = await apiClient.importSubaccountSession(payload);
    mergeSubaccount(added);
    setNotice('已录入子号 session。');
    loadLogs(added.id).catch((e) => setError((e as Error).message));
  };

  const importCredential = async (payload: Record<string, unknown>) => {
    setError('');
    setNotice('');
    const added = await apiClient.importSubaccountCodexCredential(payload as {
      credential: Record<string, unknown>;
      fileName?: string;
      groupName?: string;
    });
    mergeSubaccount(added);
    setNotice('已导入 Codex 凭证。');
    loadLogs(added.id).catch((e) => setError((e as Error).message));
  };

  const registerSubaccount = () =>
    run('subaccount-register', async () => {
      const registered = await apiClient.registerSubaccount();
      mergeSubaccount(registered);
      setNotice(
        registered.codexCredentials.length
          ? '已自动注册子号并生成 Codex 凭证。'
          : '已自动注册子号。'
      );
      loadRuntimeStatus().catch(() => undefined);
    });

  const updateLocalProfile = async (
    id: string,
    payload: { label: string; session?: Record<string, unknown> }
  ) => {
    setError('');
    setNotice('');
    try {
      const updated = await apiClient.updateSubaccountLocalProfile(id, payload);
      mergeSubaccount(updated);
      setNotice('已保存子号本地资料。');
      loadLogs(updated.id).catch((e) => setError((e as Error).message));
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };

  const startCodexAuth = (targetChatgptAccountId?: string, targetLabel?: string) =>
    selected &&
    run(targetKey('codex-start', targetChatgptAccountId), async () => {
      const started = await apiClient.startSubaccountCodexAuth(selected.id, targetChatgptAccountId);
      setAuthSession({ ...started, targetLabel });
      setNotice('已生成 Codex Auth 登录 URL。');
    });

  const autoCodexAuth = (targetChatgptAccountId?: string) =>
    selected &&
    run(targetKey('codex-auto', targetChatgptAccountId), async () => {
      const updated = await apiClient.autoSubaccountCodexAuth(selected.id, targetChatgptAccountId);
      mergeSubaccount(updated);
      setAuthSession(null);
      setCallbackUrl('');
      setNotice('Codex 自动授权完成，凭证 JSON 已生成。');
      loadRuntimeStatus().catch(() => undefined);
    });

  const completeCodexAuth = () =>
    selected &&
    authSession &&
    run('codex-callback', async () => {
      const updated = await apiClient.completeSubaccountCodexAuth(
        selected.id,
        authSession.sessionId,
        callbackUrl.trim()
      );
      mergeSubaccount(updated);
      setAuthSession(null);
      setCallbackUrl('');
      setNotice('Codex 凭证 JSON 已生成。');
    });

  const refreshQuota = (targetChatgptAccountId?: string) =>
    selected &&
    run(targetKey('quota-refresh', targetChatgptAccountId), async () => {
      setQuota(await apiClient.refreshSubaccountQuota(selected.id, targetChatgptAccountId));
      setSubaccounts(await apiClient.listSubaccounts());
    });

  const exportCredential = (targetChatgptAccountId?: string) =>
    selected &&
    run(targetKey('credential-export', targetChatgptAccountId), async () => {
      const credential = await apiClient.getSubaccountCodexCredential(selected.id, targetChatgptAccountId);
      setCredentialJson(JSON.stringify(credential, null, 2));
    });

  const removeCredential = (targetChatgptAccountId: string) =>
    selected &&
    run(targetKey('credential-delete', targetChatgptAccountId), async () => {
      const updated = await apiClient.removeSubaccountCodexCredential(selected.id, targetChatgptAccountId);
      mergeSubaccount(updated);
      setCredentialJson('');
      setQuota(null);
      setConfirmCredentialDeleteKey('');
      setNotice('已删除该 Team workspace 的 Codex 凭证。');
    });

  const syncTeamLinks = () =>
    selected &&
    run('team-link-sync', async () => {
      const updated = await apiClient.syncSubaccountTeamLinks(selected.id);
      mergeSubaccount(updated);
      setNotice('已同步子号 Team 关联。');
    });

  const removeSubaccount = async (id: string) => {
    setBusy(`remove-${id}`);
    setError('');
    setNotice('');
    try {
      await apiClient.removeSubaccount(id);
      setSubaccounts((current) => {
        const next = current.filter((subaccount) => subaccount.id !== id);
        if (selectedId === id) setSelectedId(next[0]?.id || '');
        return next;
      });
      setNotice('已删除子号本地记录。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
      setConfirmRemoveId('');
    }
  };

  const copyAuthUrl = async () => {
    if (!authSession?.authUrl) return;
    try {
      await navigator.clipboard.writeText(authSession.authUrl);
      setNotice('登录 URL 已复制。');
    } catch {
      setNotice('当前浏览器不允许复制，请手动选中 URL。');
    }
  };

  const renderCredentialRow = (row: CredentialTeamRow) => {
    const accountId = row.workspaceId || row.credential?.accountId || '';
    const credential = row.credential;
    const label = row.link ? linkLabel(row.link) : accountTeamLabel(row.account, accountId);
    const teamMeta = row.account
      ? `${row.account.label} · ${row.account.accountId}`
      : '未匹配已录入母号';
    const busyStart = targetKey('codex-start', accountId);
    const busyAuto = targetKey('codex-auto', accountId);
    const busyQuota = targetKey('quota-refresh', accountId);
    const busyExport = targetKey('credential-export', accountId);
    const busyDelete = targetKey('credential-delete', accountId);
    const credentialDeleteKey = credential && selected ? `${selected.id}:${credential.accountId}` : '';
    const confirmingCredentialDelete = Boolean(credentialDeleteKey && confirmCredentialDeleteKey === credentialDeleteKey);
    const autoAuthUnavailable = runtimeStatus?.codexAutoAuth === false;
    return (
      <div className="credential-team-row" key={row.key}>
        <div>
          <strong title={label}>{label}</strong>
          <span>
            {row.link
              ? `${row.link.seat === 'default' ? 'ChatGPT 席位' : 'Codex 席位'} · ${TEAM_LINK_STATUS_LABEL[row.link.status]}`
              : '仅有凭证记录'} · {teamMeta}
          </span>
        </div>
        <div className={`credential-row-status ${credential ? 'ready' : ''}`}>
          <strong>{credential?.fileName ?? (credential ? '凭证已生成' : '未生成凭证')}</strong>
          <span>
            {credential
              ? `CPA 号池 ${credential.groupName || '默认号池'}`
              : accountId
                ? '需要选择此 Team 授权'
                : '缺少 workspace id'}
          </span>
        </div>
        <div className="credential-row-quota">
          <strong>{quotaLabel(credential)}</strong>
          <span>
            {credential?.lastQuotaAt
              ? `刷新 ${formatRelativeTime(credential.lastQuotaAt)}`
              : credential?.lastAuthAt
                ? `授权 ${formatRelativeTime(credential.lastAuthAt)}`
                : '暂无额度缓存'}
          </span>
        </div>
        <div className="credential-row-actions">
          <button
            className="primary"
            onClick={() => autoCodexAuth(accountId)}
            disabled={!selected || !accountId || busy === busyAuto || autoAuthUnavailable}
            title={autoAuthUnavailable ? '自动授权运行依赖未就绪，请先检查配置状态' : undefined}
          >
            {busy === busyAuto ? '授权中' : '自动授权'}
          </button>
          <button
            onClick={() => startCodexAuth(accountId, label)}
            disabled={!selected || !accountId || busy === busyStart}
          >
            {busy === busyStart ? '生成中' : '登录 URL'}
          </button>
          <button onClick={() => refreshQuota(accountId)} disabled={!credential || busy === busyQuota}>
            {busy === busyQuota ? '查询中' : '刷新额度'}
          </button>
          <button onClick={() => exportCredential(accountId)} disabled={!credential || busy === busyExport}>
            {busy === busyExport ? '读取中' : '凭证 JSON'}
          </button>
          {credential && (
            confirmingCredentialDelete ? (
              <span className="inline-confirm">
                <button
                  type="button"
                  className="danger"
                  onClick={() => removeCredential(credential.accountId)}
                  disabled={busy === busyDelete}
                >
                  {busy === busyDelete ? '删除中' : '确认删除凭证'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setConfirmCredentialDeleteKey('')}
                  disabled={busy === busyDelete}
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="danger"
                onClick={() => setConfirmCredentialDeleteKey(credentialDeleteKey)}
                disabled={busy === busyDelete}
              >
                删除凭证
              </button>
            )
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="subaccount-shell">
      <SessionImportDialog
        open={sessionDialogOpen}
        title="录入子号 Session"
        description="保存子号本地记录后，可继续生成 Codex 凭证并查询额度。"
        submitLabel="保存子号"
        busyLabel="正在保存子号本地记录"
        onClose={() => setSessionDialogOpen(false)}
        onSubmit={importSession}
      />

      <CredentialImportDialog
        open={credentialDialogOpen}
        onClose={() => setCredentialDialogOpen(false)}
        onSubmit={importCredential}
      />

      <LocalProfileDialog
        open={Boolean(editingSubaccount)}
        title="编辑子号本地资料"
        description="只更新本系统保存的备注名和 Web session，不修改 Codex 凭证。"
        initialLabel={editingSubaccount?.label ?? ''}
        submitLabel="保存子号资料"
        busyLabel="正在保存子号本地资料"
        onClose={() => setEditingSubaccount(null)}
        onSubmit={(payload) => updateLocalProfile(editingSubaccount!.id, payload)}
      />

      {removingSubaccount && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !removingSubaccountBusy) setConfirmRemoveId('');
          }}
        >
          <section
            className="modal-panel confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={removeDialogTitleId}
          >
            <div className="modal-head">
              <div>
                <h2 id={removeDialogTitleId}>删除子号</h2>
                <p>{removingSubaccount.label}</p>
              </div>
            </div>
            <div className="confirm-copy">
              仅从本系统移除这个子号本地记录，不会移除 ChatGPT Team 成员，也不会撤销远端凭证。
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirmRemoveId('')} disabled={removingSubaccountBusy}>
                取消
              </button>
              <button
                className="danger"
                onClick={() => void removeSubaccount(removingSubaccount.id)}
                disabled={removingSubaccountBusy}
              >
                {removingSubaccountBusy ? '删除中' : '确认删除'}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="accounts-pane subaccount-list-pane" aria-label="子号列表">
        <div className="pane-head">
          <div>
            <h2>子号</h2>
            <span>{subaccounts.length} 个账号</span>
          </div>
          <div className="pane-actions">
            <button
              className="primary"
              onClick={registerSubaccount}
              disabled={busy === 'subaccount-register' || runtimeStatus?.subaccountRegistration === false}
              title={runtimeStatus?.subaccountRegistration === false ? '自动注册运行依赖未就绪，请先检查配置状态' : undefined}
            >
              {busy === 'subaccount-register' ? '注册中' : '自动注册'}
            </button>
            <button className="primary" onClick={() => setSessionDialogOpen(true)}>
              录入子号
            </button>
            <button onClick={() => setCredentialDialogOpen(true)}>导入凭证</button>
          </div>
        </div>

        <div className="account-list">
          {loading && subaccounts.length === 0 && (
            <>
              <div className="account-skeleton" />
              <div className="account-skeleton" />
            </>
          )}
          {!loading && subaccounts.length === 0 && (
            <div className="empty-panel">
              <h3>还没有子号</h3>
              <p>可录入子号 session JSON，也可导入已有 CPA/Codex credential JSON。</p>
              <div className="empty-actions">
                <button
                  className="primary"
                  onClick={registerSubaccount}
                  disabled={busy === 'subaccount-register' || runtimeStatus?.subaccountRegistration === false}
                >
                  {busy === 'subaccount-register' ? '注册中' : '自动注册'}
                </button>
                <button className="primary" onClick={() => setSessionDialogOpen(true)}>
                  录入子号
                </button>
                <button onClick={() => setCredentialDialogOpen(true)}>导入凭证</button>
              </div>
            </div>
          )}
          {subaccounts.map((subaccount) => {
            const repeatedEmail = subaccount.label.trim().toLowerCase() === subaccount.email.trim().toLowerCase();
            return (
              <WorkspaceListCard
                key={subaccount.id}
                selected={selected?.id === subaccount.id}
                status={subaccount.status === 'error' ? 'invalid' : 'active'}
                statusLabel={STATUS_LABEL[subaccount.status]}
                title={subaccount.label}
                subtitle={repeatedEmail ? undefined : subaccount.email}
                meta={[
                  { content: subaccount.hasWebSession ? 'Web Session 已录入' : '无 Web Session' },
                  { content: `Codex 凭证 ${subaccount.codexCredentials.length} 份` },
                  { content: `更新 ${formatTime(subaccount.updatedAt)}` }
                ]}
                error={
                  subaccount.lastError && <span title={subaccount.lastError}>{shortError(subaccount.lastError)}</span>
                }
                menu={
                  <details className="card-menu" onClick={(event) => event.stopPropagation()}>
                    <summary aria-label="更多操作">⋮</summary>
                    <div className="menu-content">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          setEditingSubaccount(subaccount);
                        }}
                      >
                        编辑本地资料
                      </button>
                      <button
                        type="button"
                        className="danger menu-danger"
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          setConfirmRemoveId(subaccount.id);
                        }}
                      >
                        删除子号
                      </button>
                    </div>
                  </details>
                }
                onSelect={() => setSelectedId(subaccount.id)}
              />
            );
          })}
        </div>
      </section>

      <section className="workspace-card subaccount-workspace">
        <div className="workspace-head">
          <div>
            <h2>{selected ? selected.label : '子号管理'}</h2>
            <p>{selected ? selected.email : '录入子号 session，生成 Codex 凭证，查询凭证额度。'}</p>
          </div>
        </div>

        {notice && <div className="banner info">{notice}</div>}
        {error && <div className="banner error">{error}</div>}

        <section className="block">
          <div className="section-head">
            <h3>凭证与 Codex Auth</h3>
            <div className="section-actions">
              <span>{selected ? STATUS_LABEL[selected.status] : '未选择子号'}</span>
              <button
                type="button"
                className="ghost tiny-action"
                onClick={loadRuntimeStatus}
                disabled={runtimeLoading}
              >
                {runtimeLoading ? '检查中' : '检查配置'}
              </button>
            </div>
          </div>
          <div className="runtime-status-panel">
            <div className="runtime-status-head">
              <div>
                <strong>自动授权运行能力</strong>
                <span>连接参数来自运行环境，只读展示可用状态，不在页面保存配置。</span>
              </div>
              <span className={`runtime-summary ${runtimeCapabilityClass(runtimeStatus?.codexAutoAuth)}`}>
                {runtimeStatus
                  ? runtimeStatus.codexAutoAuth
                    ? '自动授权可用'
                    : '自动授权不可用'
                  : '未检查'}
              </span>
            </div>
            <div className="runtime-capability-grid">
              <div className={`runtime-capability ${runtimeCapabilityClass(runtimeStatus?.workerReachable)}`}>
                <span>worker</span>
                <strong>{runtimeStatus?.workerReachable ? '可连接' : runtimeStatus ? '不可连接' : '未检查'}</strong>
              </div>
              <div className={`runtime-capability ${runtimeCapabilityClass(runtimeStatus?.gongxiMail)}`}>
                <span>GongXi-Mail</span>
                <strong>{runtimeStatus?.gongxiMail ? '已配置' : runtimeStatus ? '未就绪' : '未检查'}</strong>
              </div>
              <div className={`runtime-capability ${runtimeCapabilityClass(runtimeStatus?.subaccountRegistration)}`}>
                <span>自动注册</span>
                <strong>{runtimeStatus?.subaccountRegistration ? '可用' : runtimeStatus ? '不可用' : '未检查'}</strong>
              </div>
              <div className={`runtime-capability ${runtimeCapabilityClass(runtimeStatus?.phoneOtp)}`}>
                <span>短信接码</span>
                <strong>
                  {runtimeStatus?.phoneOtp
                    ? `${runtimeStatus.phonePoolCount ?? 0} 可用 / ${runtimeStatus.phonePoolExhaustedCount ?? 0} 用尽`
                    : runtimeStatus
                      ? '不可用'
                      : '未检查'}
                </strong>
              </div>
              <div className={`runtime-capability ${runtimeCapabilityClass(runtimeStatus?.flaresolverr)}`}>
                <span>授权页面</span>
                <strong>{runtimeStatus?.flaresolverr ? '可通过' : runtimeStatus ? '未就绪' : '未检查'}</strong>
              </div>
            </div>
            {runtimeStatus?.error && <div className="runtime-warning">{shortError(runtimeStatus.error)}</div>}
            {runtimeStatus?.codexAutoAuth === false && (
              <div className="runtime-warning">
                自动授权依赖缺失时可使用登录 URL 手动授权；GongXi-Mail、短信接码和 worker 连接配置应在运行环境中处理。
              </div>
            )}
          </div>
          <div className="credential-state-grid">
            <div className={`credential-card ${selected?.hasWebSession ? 'ready' : ''}`}>
              <span>Web Session</span>
              <strong>{selected?.hasWebSession ? '已录入' : '未录入'}</strong>
              <em>{selected?.chatgptAccountId ? `account ${selected.chatgptAccountId}` : '用于 ChatGPT Web 请求'}</em>
            </div>
            <div className={`credential-card ${credentialCount > 0 ? 'ready' : ''}`}>
              <span>Codex 凭证</span>
              <strong>{credentialCount} 份</strong>
              <em>{latestAuthCredential?.lastAuthAt ? `最近授权 ${formatRelativeTime(latestAuthCredential.lastAuthAt)}` : '按 Team workspace 单独生成'}</em>
            </div>
            <div className={`credential-card ${quotaCacheCount > 0 ? 'ready' : ''}`}>
              <span>额度缓存</span>
              <strong>{quotaCacheCount} 份</strong>
              <em>{latestQuotaCredential?.lastQuotaAt ? `最近刷新 ${formatRelativeTime(latestQuotaCredential.lastQuotaAt)}` : '每个 Team 单独刷新'}</em>
            </div>
          </div>
          {credentialTeamRows.length === 0 && (
            <div className="relation-empty">
              先刷新 Team 关联，再按每个 Team workspace 生成对应的 Codex 凭证。
            </div>
          )}
          {credentialTeamRows.length > 0 && (
            <div className="credential-team-list">{credentialTeamRows.map(renderCredentialRow)}</div>
          )}
          {authSession?.authUrl && (
            <div className="auth-url-panel">
              <div>
                <span>手动授权 URL{authSession.targetLabel ? ` · ${authSession.targetLabel}` : ''}</span>
                <code>{authSession.authUrl}</code>
              </div>
              <div className="panel-actions">
                <button className="ghost" onClick={copyAuthUrl}>
                  复制 URL
                </button>
                <button
                  className="ghost"
                  onClick={() => window.open(authSession.authUrl, '_blank', 'noopener,noreferrer')}
                >
                  打开 URL
                </button>
              </div>
            </div>
          )}
          {authSession && (
            <details className="manual-callback">
              <summary>手动粘贴授权回调</summary>
              <textarea
                className="callback-input"
                value={callbackUrl}
                spellCheck={false}
                placeholder="粘贴 http://localhost:1455/auth/callback?code=...&state=..."
                onChange={(event) => setCallbackUrl(event.target.value)}
              />
              <div className="panel-actions">
                <button
                  onClick={completeCodexAuth}
                  disabled={!selected || !callbackUrl.trim() || busy === 'codex-callback'}
                >
                  {busy === 'codex-callback' ? '换取中' : '提交回调并生成凭证'}
                </button>
              </div>
            </details>
          )}
          {quota && (
            <div className="quota-grid">
              {quota.windows.length === 0 && <div className="quota-empty">{quota.error ?? '暂无额度窗口'}</div>}
              {quota.windows.map((window) => (
                <div className="quota-item" key={window.id}>
                  <span>{window.label}</span>
                  <strong>{window.usedPercent ?? '暂无'}%</strong>
                  <em>重置 {window.resetAt ? formatTime(window.resetAt) : '暂无'}</em>
                </div>
              ))}
            </div>
          )}
          {credentialJson && (
            <textarea className="credential-output" value={credentialJson} readOnly spellCheck={false} />
          )}
        </section>

        <section className="block">
          <div className="section-head">
            <h3 className="title-with-loader">
              Team 关联
              {busy === 'team-link-sync' && (
                <span className="jumping-dots" role="status" aria-label="正在更新 Team 关联">
                  <span />
                  <span />
                  <span />
                </span>
              )}
            </h3>
            <div className="section-actions">
              <span>
                已在 {memberLinkCount} 个，邀请中 {invitedLinkCount} 个，上次刷新 {formatRelativeTime(teamLinksSyncedAt)}
              </span>
              <button
                type="button"
                className="ghost tiny-action"
                onClick={syncTeamLinks}
                disabled={!selected || busy === 'team-link-sync'}
              >
                刷新
              </button>
            </div>
          </div>
          {teamLinks.length === 0 && (
            <div className="relation-empty">
              暂无关联记录。点击刷新可检查该子号是否已在任何已录入母号中。
            </div>
          )}
          {teamLinks.length > 0 && (
            <div className="link-list">
              {teamLinks.map((link) => (
                <div className="link-row" key={link.accountId}>
                  <span title={linkLabel(link)}>{linkLabel(link)}</span>
                  <span>{link.seat === 'default' ? 'ChatGPT 席位' : 'Codex 席位'}</span>
                  <span className={`link-status status-${link.status}`}>{TEAM_LINK_STATUS_LABEL[link.status]}</span>
                  <span>同步 {formatTime(link.updatedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="block">
          <div className="section-head">
            <h3>验证与授权日志</h3>
            <span>{logs.length} 条</span>
          </div>
          <div className={`auth-progress-panel ${authProgress.running ? 'running' : ''}`}>
            <div className="auth-progress-head">
              <div>
                <strong>自动授权流程</strong>
                <span>{authProgressTargetLabel}</span>
              </div>
              <span
                className={`auth-progress-summary ${
                  authProgress.failed ? 'error' : authProgress.completed ? 'done' : authProgress.running ? 'active' : ''
                }`}
              >
                {authProgress.failed
                  ? '需要处理'
                  : authProgress.completed
                    ? '已完成'
                    : authProgress.running
                      ? '运行中'
                      : '暂无运行'}
              </span>
            </div>
            <div className="auth-step-list">
              {AUTH_PROGRESS_STEPS.map((step, index) => {
                const status = authStepStatus(step, index, authProgress);
                return (
                  <div className={`auth-step ${status}`} key={step.id}>
                    <span className="auth-step-marker" aria-hidden="true" />
                    <div>
                      <strong>{step.label}</strong>
                      <span>{step.detail}</span>
                    </div>
                    <em>{authStepStatusText(status)}</em>
                  </div>
                );
              })}
            </div>
            {authProgress.logs.length > 0 ? (
              <div className="auth-event-list">
                {authProgress.logs.slice(-8).map((log) => (
                  <div className={`auth-event ${isFailureLog(log) ? 'error' : ''}`} key={log.id}>
                    <strong title={log.phase}>{phaseLabel(log.phase)}</strong>
                    <span>{log.message}</span>
                    <em>{logMeta(log)}</em>
                  </div>
                ))}
              </div>
            ) : (
              <div className="auth-progress-empty">
                {authProgress.running ? '请求已发出，等待 worker 返回阶段事件。' : '暂无自动授权记录。'}
              </div>
            )}
          </div>
          <div className="log-list">
            {logs.length === 0 && <div className="table-empty">暂无日志</div>}
            {logs.map((log) => (
              <div className="log-item" key={log.id}>
                <div>
                  <strong title={log.phase}>{phaseLabel(log.phase)}</strong>
                  <span className={`log-status ${isFailureLog(log) ? 'error' : log.status === 'ok' || log.status === 'codex_ready' ? 'ok' : ''}`}>
                    {log.status}
                  </span>
                </div>
                <p>{log.message}</p>
                <em>{formatTime(log.createdAt)}</em>
              </div>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}
