import type { SubaccountAuthLog } from '@team-manager/shared';

export type AuthProgressStepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'error';

export interface AuthProgressStep {
  id: string;
  label: string;
  detail: string;
  phases: string[];
  optional?: boolean;
}

export interface AuthProgress {
  logs: SubaccountAuthLog[];
  target?: string;
  running: boolean;
  completed: boolean;
  failed: boolean;
}

export const AUTH_PROGRESS_STEPS: AuthProgressStep[] = [
  { id: 'start', label: '启动', detail: '创建授权会话', phases: ['codex_auto_auth_start'] },
  {
    id: 'email',
    label: '邮箱',
    detail: '发送并验证 OTP',
    phases: ['email_otp_send_loop', 'passwordless_send_otp', 'passwordless_validate_otp', 'email_otp_done'],
    optional: true
  },
  {
    id: 'phone',
    label: '手机',
    detail: '绑定或二次验证',
    phases: ['phone_slot_selected', 'phone_otp_done', 'bound_phone_slot_selected', 'bound_phone_otp_done'],
    optional: true
  },
  {
    id: 'challenge',
    label: '页面校验',
    detail: '处理 auth challenge',
    phases: ['auth_challenge_required', 'human_verification_solver_start', 'flaresolverr_authorize', 'account_locked'],
    optional: true
  },
  {
    id: 'workspace',
    label: 'Team',
    detail: '选择目标 workspace',
    phases: ['organization_select', 'workspace_select', 'account_select'],
    optional: true
  },
  { id: 'token', label: '凭证', detail: '换取并保存 token', phases: ['oauth_token_exchange', 'codex_auto_auth_complete'] }
];

const PHASE_LABEL: Record<string, string> = {
  codex_auto_auth_start: '启动自动授权',
  codex_auto_auth_complete: '自动授权完成',
  email_otp_send_loop: '等待邮箱 OTP',
  passwordless_send_otp: '发送邮箱 OTP',
  passwordless_validate_otp: '验证邮箱 OTP',
  email_otp_done: '邮箱验证完成',
  phone_slot_selected: '已选择手机号',
  phone_otp_done: '短信验证完成',
  bound_phone_slot_selected: '已匹配绑定手机号',
  bound_phone_otp_done: '绑定手机号验证完成',
  auth_challenge_required: '需要页面校验',
  human_verification_solver_start: '开始页面校验',
  flaresolverr_authorize: '授权页 clearance',
  account_locked: '账号锁定',
  organization_select: '选择组织',
  workspace_select: '选择 Team workspace',
  account_select: '选择账号',
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

function logData(log: SubaccountAuthLog): Record<string, unknown> {
  return log.data && typeof log.data === 'object' ? (log.data as Record<string, unknown>) : {};
}

function logTargetAccountId(log: SubaccountAuthLog): string | undefined {
  const data = logData(log);
  const target = data.targetChatgptAccountId ?? data.accountId;
  return typeof target === 'string' && target.trim() ? target.trim() : undefined;
}

export function isFailureLog(log: SubaccountAuthLog): boolean {
  return log.status === 'error' || log.status === 'account_locked' || log.status === 'verification_required';
}

function isAutoAuthLog(log: SubaccountAuthLog): boolean {
  return log.phase === 'codex_auto_auth_start' || log.phase === 'codex_auto_auth_complete' || AUTO_AUTH_PHASES.has(log.phase);
}

export function buildAuthProgress(logs: SubaccountAuthLog[], runningTarget: string): AuthProgress {
  const target = runningTarget && runningTarget !== 'default' ? runningTarget : undefined;
  const scopedLogs = logs
    .filter(isAutoAuthLog)
    .filter((log) => !target || logTargetAccountId(log) === target);
  const latestStart = scopedLogs.find((log) => log.phase === 'codex_auto_auth_start');
  const startAt = latestStart?.createdAt ?? scopedLogs[scopedLogs.length - 1]?.createdAt;
  const cycleLogs = startAt ? scopedLogs.filter((log) => log.createdAt >= startAt).sort((a, b) => a.createdAt - b.createdAt) : [];
  return {
    logs: cycleLogs,
    target: target ?? cycleLogs.map(logTargetAccountId).find(Boolean),
    running: Boolean(runningTarget),
    completed: cycleLogs.some((log) => log.phase === 'codex_auto_auth_complete' && log.status === 'codex_ready'),
    failed: cycleLogs.some(isFailureLog)
  };
}

export function authStepStatus(step: AuthProgressStep, index: number, progress: AuthProgress): AuthProgressStepStatus {
  const stepLogs = progress.logs.filter((log) => step.phases.includes(log.phase));
  if (stepLogs.some(isFailureLog)) return 'error';
  if (stepLogs.length > 0) return 'done';
  const laterHasLogs = AUTH_PROGRESS_STEPS.slice(index + 1).some((later) =>
    progress.logs.some((log) => later.phases.includes(log.phase))
  );
  if ((progress.completed || laterHasLogs) && step.optional) return 'skipped';
  if (progress.running) return 'active';
  return 'pending';
}

export function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase] ?? phase.replace(/_/g, ' ');
}

export function logMeta(log: SubaccountAuthLog): string {
  const data = logData(log);
  const httpStatus = typeof data.httpStatus === 'number' ? `HTTP ${data.httpStatus}` : '';
  const pageType = typeof data.pageType === 'string' && data.pageType ? data.pageType : '';
  return [log.status, httpStatus, pageType].filter(Boolean).join(' · ');
}
