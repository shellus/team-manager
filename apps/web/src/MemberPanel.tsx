import { useEffect, useId, useState, useCallback } from 'react';
import type {
  AccountMemberProfile,
  AccountMemberProfileInput,
  AccountView,
  Member,
  PendingInvite,
  SeatType
} from '@team-manager/shared';
import { BILLING_RISK_CONFIRM_MESSAGE, MAX_CHATGPT_SEATS, getChatGptSessionUserEmail } from '@team-manager/shared';
import { apiClient, ApiError } from './api.js';
import { roleLabel, seatLabel, SEAT_LABEL } from './labels.js';
import { SettingSwitch } from './SettingSwitch.js';

type BillingRisk =
  | { kind: 'invite'; email: string; seat: SeatType; memberProfile: AccountMemberProfileInput }
  | { kind: 'member-seat'; userId: string; email: string; seat: SeatType };

type RunOptions<T> = {
  risk?: BillingRisk;
  after?: (result: T) => Promise<void> | void;
};

type ActiveDialog = 'invite' | 'settings' | 'member-profile' | null;

type EditingMemberProfile = {
  email: string;
  source: 'pending' | 'member';
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
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

function isBillingRiskError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.message === BILLING_RISK_CONFIRM_MESSAGE;
}

function booleanSettingLabel(value?: boolean) {
  if (typeof value !== 'boolean') return '暂无';
  return value ? '允许' : '关闭';
}

function latestTime(...values: Array<number | undefined>) {
  const latest = Math.max(0, ...values.map((value) => value ?? 0));
  return latest || undefined;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function defaultExpiresOn() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function profileForEmail(
  profiles: AccountView['memberProfiles'] | undefined,
  email: string
): AccountMemberProfile | undefined {
  return profiles?.[normalizeEmail(email)];
}

function profileSummary(profile: AccountMemberProfile | undefined) {
  if (!profile) return '未设置';
  const flags = [
    profile.expireReminder ? '提醒' : '不提醒',
    profile.expireRemove ? '到期移除' : '保留成员'
  ];
  return `${profile.expiresOn} · ${flags.join(' · ')}`;
}

export function MemberPanel({
  account,
  syncing,
  onSync,
  onAccountChanged,
  onRenameTeam,
  onUpdateLocalProfile
}: {
  account: AccountView;
  syncing: boolean;
  onSync: () => void;
  onAccountChanged: (account: AccountView) => void;
  onRenameTeam: (id: string, name: string) => Promise<AccountView>;
  onUpdateLocalProfile: (
    id: string,
    payload: { note?: string; groupName?: string; session?: Record<string, unknown> }
  ) => Promise<AccountView>;
}) {
  const inviteTitleId = useId();
  const settingsTitleId = useId();
  const profileTitleId = useId();
  const [members, setMembers] = useState<Member[]>(() => account.membersCache ?? []);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>(() => account.pendingInvitesCache ?? []);
  const [membersCachedAt, setMembersCachedAt] = useState(account.membersCachedAt);
  const [pendingInvitesCachedAt, setPendingInvitesCachedAt] = useState(account.pendingInvitesCachedAt);
  const [defaultSeatCachedAt, setDefaultSeatCachedAt] = useState(account.defaultSeatCachedAt);
  const [workspaceReferralsEnabledCachedAt, setWorkspaceReferralsEnabledCachedAt] = useState(
    account.workspaceReferralsEnabledCachedAt
  );
  const [personalAccessTokensCachedAt, setPersonalAccessTokensCachedAt] = useState(
    account.personalAccessTokensCachedAt
  );
  const [membersRefreshing, setMembersRefreshing] = useState(false);
  const [invitesRefreshing, setInvitesRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSeat, setInviteSeat] = useState<SeatType>(account.defaultSeat ?? 'usage_based');
  const [inviteProfileNote, setInviteProfileNote] = useState('');
  const [inviteProfileExpiresOn, setInviteProfileExpiresOn] = useState(defaultExpiresOn);
  const [inviteProfileExpireRemove, setInviteProfileExpireRemove] = useState(false);
  const [inviteProfileExpireReminder, setInviteProfileExpireReminder] = useState(true);
  const [teamNameDraft, setTeamNameDraft] = useState(account.workspaceName ?? '');
  const [localNoteDraft, setLocalNoteDraft] = useState(account.note ?? '');
  const [localGroupNameDraft, setLocalGroupNameDraft] = useState(account.groupName || '默认分组');
  const [localSessionDraft, setLocalSessionDraft] = useState('');
  const [localSessionEmail, setLocalSessionEmail] = useState('');
  const [defaultSeat, setDefaultSeat] = useState<SeatType | ''>(account.defaultSeat ?? '');
  const [defaultSeatDraft, setDefaultSeatDraft] = useState<SeatType>(account.defaultSeat ?? 'usage_based');
  const [workspaceReferralsEnabled, setWorkspaceReferralsEnabled] = useState<boolean | undefined>(
    account.workspaceReferralsEnabled
  );
  const [workspaceReferralsEnabledVisible, setWorkspaceReferralsEnabledVisible] = useState<boolean | undefined>(
    account.workspaceReferralsEnabledVisible
  );
  const [workspaceReferralsEnabledDraft, setWorkspaceReferralsEnabledDraft] = useState(
    account.workspaceReferralsEnabled ?? false
  );
  const [personalAccessTokensEnabled, setPersonalAccessTokensEnabled] = useState<boolean | undefined>(
    account.personalAccessTokensEnabled
  );
  const [personalAccessTokensDraft, setPersonalAccessTokensDraft] = useState(
    account.personalAccessTokensEnabled ?? false
  );
  const [billingRisk, setBillingRisk] = useState<BillingRisk | null>(null);
  const [confirmKickId, setConfirmKickId] = useState('');
  const [confirmRevokeEmail, setConfirmRevokeEmail] = useState('');
  const [editingProfile, setEditingProfile] = useState<EditingMemberProfile | null>(null);
  const [profileNoteDraft, setProfileNoteDraft] = useState('');
  const [profileExpiresOnDraft, setProfileExpiresOnDraft] = useState(defaultExpiresOn);
  const [profileExpireRemoveDraft, setProfileExpireRemoveDraft] = useState(false);
  const [profileExpireReminderDraft, setProfileExpireReminderDraft] = useState(true);

  const applyAccountView = useCallback(
    (updated: AccountView) => {
      onAccountChanged(updated);
      setMembers(updated.membersCache ?? []);
      setPendingInvites(updated.pendingInvitesCache ?? []);
      setMembersCachedAt(updated.membersCachedAt);
      setPendingInvitesCachedAt(updated.pendingInvitesCachedAt);
      setDefaultSeatCachedAt(updated.defaultSeatCachedAt);
      setDefaultSeat(updated.defaultSeat ?? '');
      setDefaultSeatDraft(updated.defaultSeat ?? 'usage_based');
      setWorkspaceReferralsEnabledCachedAt(updated.workspaceReferralsEnabledCachedAt);
      setWorkspaceReferralsEnabled(updated.workspaceReferralsEnabled);
      setWorkspaceReferralsEnabledVisible(updated.workspaceReferralsEnabledVisible);
      setWorkspaceReferralsEnabledDraft(updated.workspaceReferralsEnabled ?? false);
      setPersonalAccessTokensCachedAt(updated.personalAccessTokensCachedAt);
      setPersonalAccessTokensEnabled(updated.personalAccessTokensEnabled);
      setPersonalAccessTokensDraft(updated.personalAccessTokensEnabled ?? false);
      setInviteSeat(updated.defaultSeat ?? 'usage_based');
      setTeamNameDraft(updated.workspaceName ?? '');
      setLocalNoteDraft(updated.note ?? '');
      setLocalGroupNameDraft(updated.groupName || '默认分组');
    },
    [onAccountChanged]
  );

  const refreshSettings = useCallback(async () => {
    applyAccountView(await apiClient.refreshSettings(account.id));
  }, [account.id, applyAccountView]);

  const refreshMembers = useCallback(async () => {
    setMembersRefreshing(true);
    try {
      applyAccountView(await apiClient.refreshMembers(account.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMembersRefreshing(false);
    }
  }, [account.id, applyAccountView]);

  const refreshInvites = useCallback(async () => {
    setInvitesRefreshing(true);
    try {
      applyAccountView(await apiClient.refreshPendingInvites(account.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInvitesRefreshing(false);
    }
  }, [account.id, applyAccountView]);

  useEffect(() => {
    setMembers(account.membersCache ?? []);
    setPendingInvites(account.pendingInvitesCache ?? []);
    setMembersCachedAt(account.membersCachedAt);
    setPendingInvitesCachedAt(account.pendingInvitesCachedAt);
    setDefaultSeatCachedAt(account.defaultSeatCachedAt);
    setDefaultSeat(account.defaultSeat ?? '');
    setDefaultSeatDraft(account.defaultSeat ?? 'usage_based');
    setWorkspaceReferralsEnabledCachedAt(account.workspaceReferralsEnabledCachedAt);
    setWorkspaceReferralsEnabled(account.workspaceReferralsEnabled);
    setWorkspaceReferralsEnabledVisible(account.workspaceReferralsEnabledVisible);
    setWorkspaceReferralsEnabledDraft(account.workspaceReferralsEnabled ?? false);
    setPersonalAccessTokensCachedAt(account.personalAccessTokensCachedAt);
    setPersonalAccessTokensEnabled(account.personalAccessTokensEnabled);
    setPersonalAccessTokensDraft(account.personalAccessTokensEnabled ?? false);
    setInviteSeat(account.defaultSeat ?? 'usage_based');
    setTeamNameDraft(account.workspaceName ?? '');
    setLocalNoteDraft(account.note ?? '');
    setLocalGroupNameDraft(account.groupName || '默认分组');
    setLocalSessionDraft('');
    setLocalSessionEmail('');
    resetInviteProfileDraft();
  }, [
    account.id,
    account.note,
    account.groupName,
    account.workspaceName,
    account.membersCache,
    account.membersCachedAt,
    account.pendingInvitesCache,
    account.pendingInvitesCachedAt,
    account.defaultSeat,
    account.defaultSeatCachedAt,
    account.workspaceReferralsEnabled,
    account.workspaceReferralsEnabledVisible,
    account.workspaceReferralsEnabledCachedAt,
    account.personalAccessTokensEnabled,
    account.personalAccessTokensCachedAt
  ]);

  useEffect(() => {
    setError('');
    setBusy('');
    setBillingRisk(null);
    setConfirmKickId('');
    setConfirmRevokeEmail('');
    setEditingProfile(null);
    setActiveDialog(null);
  }, [account.id]);

  useEffect(() => {
    if (!activeDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setEditingProfile(null);
        setActiveDialog(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDialog, busy]);

  const loadedChatgptSeats = members.filter((m) => m.seat === 'default').length;
  const hasMemberSnapshot = Boolean(account.membersCache || membersCachedAt);
  const hasInviteSnapshot = Boolean(account.pendingInvitesCache || pendingInvitesCachedAt);
  const chatgptSeats = hasMemberSnapshot ? loadedChatgptSeats : undefined;
  const memberCount = hasMemberSnapshot ? members.length : undefined;
  const inviteCount = hasInviteSnapshot ? pendingInvites.length : undefined;
  const atLimit = typeof chatgptSeats === 'number' && chatgptSeats >= MAX_CHATGPT_SEATS;
  const settingsCachedAt = latestTime(
    defaultSeatCachedAt,
    workspaceReferralsEnabledCachedAt,
    personalAccessTokensCachedAt
  );
  const memberStatusText = hasMemberSnapshot
    ? `${members.length} 人，上次刷新 ${formatRelativeTime(membersCachedAt)}`
    : '暂无缓存';
  const inviteStatusText = hasInviteSnapshot
    ? `${pendingInvites.length} 条，上次刷新 ${formatRelativeTime(pendingInvitesCachedAt)}`
    : '暂无缓存';

  const run = async <T,>(key: string, fn: () => Promise<T>, options: RunOptions<T> = {}) => {
    setBusy(key);
    setError('');
    setBillingRisk(null);
    try {
      const result = await fn();
      await options.after?.(result);
    } catch (e) {
      if (options.risk && isBillingRiskError(e)) {
        setBillingRisk(options.risk);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy('');
    }
  };

  const resetInviteProfileDraft = () => {
    setInviteProfileNote('');
    setInviteProfileExpiresOn(defaultExpiresOn());
    setInviteProfileExpireRemove(false);
    setInviteProfileExpireReminder(true);
  };

  const currentInviteProfile = (): AccountMemberProfileInput => ({
    note: inviteProfileNote.trim(),
    expiresOn: inviteProfileExpiresOn,
    expireRemove: inviteProfileExpireRemove,
    expireReminder: inviteProfileExpireReminder
  });

  const submitInvite = (confirmBillingRisk = false, preset?: Extract<BillingRisk, { kind: 'invite' }>) => {
    const email = (preset?.email ?? inviteEmail).trim();
    const seat = preset?.seat ?? inviteSeat;
    const memberProfile = preset?.memberProfile ?? currentInviteProfile();
    if (!email || !memberProfile.expiresOn) return;
    void run(
      'invite',
      async () => {
        const updated = await apiClient.invite(account.id, email, seat, memberProfile, confirmBillingRisk);
        applyAccountView(updated);
        setInviteEmail('');
        resetInviteProfileDraft();
        return updated;
      },
      {
        risk: { kind: 'invite', email, seat, memberProfile },
        after: () => setActiveDialog(null)
      }
    );
  };

  const beginEditProfile = (email: string, source: EditingMemberProfile['source']) => {
    const profile = profileForEmail(account.memberProfiles, email);
    setEditingProfile({ email, source });
    setProfileNoteDraft(profile?.note ?? '');
    setProfileExpiresOnDraft(profile?.expiresOn ?? defaultExpiresOn());
    setProfileExpireRemoveDraft(profile?.expireRemove ?? false);
    setProfileExpireReminderDraft(profile?.expireReminder ?? true);
    setActiveDialog('member-profile');
  };

  const saveMemberProfile = () => {
    if (!editingProfile || !profileExpiresOnDraft) return;
    const email = editingProfile.email;
    void run(`profile-${normalizeEmail(email)}`, async () => {
      applyAccountView(
        await apiClient.updateMemberProfile(account.id, {
          email,
          note: profileNoteDraft.trim(),
          expiresOn: profileExpiresOnDraft,
          expireRemove: profileExpireRemoveDraft,
          expireReminder: profileExpireReminderDraft
        })
      );
      setEditingProfile(null);
      setActiveDialog(null);
    });
  };

  const updateLocalSessionDraft = (value: string) => {
    setLocalSessionDraft(value);
    if (!value.trim()) {
      setLocalSessionEmail('');
      return;
    }
    try {
      setLocalSessionEmail(getChatGptSessionUserEmail(JSON.parse(value)) ?? '');
    } catch {
      setLocalSessionEmail('');
    }
  };

  const saveTeamName = () => {
    const next = teamNameDraft.trim();
    if (!next) return;
    void run('team-name', async () => {
      applyAccountView(await onRenameTeam(account.id, next));
    });
  };

  const saveLocalProfile = () => {
    const groupName = localGroupNameDraft.trim() || '默认分组';
    void run('local-profile', async () => {
      let session: Record<string, unknown> | undefined;
      if (localSessionDraft.trim()) {
        try {
          session = JSON.parse(localSessionDraft) as Record<string, unknown>;
        } catch {
          throw new Error('JSON 解析失败，请检查格式');
        }
      }
      applyAccountView(
        await onUpdateLocalProfile(account.id, {
          note: localNoteDraft.trim(),
          groupName,
          ...(session ? { session } : {})
        })
      );
      setLocalSessionDraft('');
      setLocalSessionEmail('');
    });
  };

  const changeMemberSeat = (member: Member, seat: SeatType, confirmBillingRisk = false) => {
    void run(
      `seat-${member.userId}`,
      () => apiClient.setMemberSeat(account.id, member.userId, seat, confirmBillingRisk),
      {
        risk: { kind: 'member-seat', userId: member.userId, email: member.email, seat },
        after: applyAccountView
      }
    );
  };

  const confirmBillingRiskAction = () => {
    if (!billingRisk) return;
    if (billingRisk.kind === 'invite') {
      submitInvite(true, billingRisk);
      return;
    }
    const member = members.find((item) => item.userId === billingRisk.userId);
    if (member) changeMemberSeat(member, billingRisk.seat, true);
  };

  const billingRiskNotice = billingRisk ? (
    <div className="billing-risk">
      <span>{BILLING_RISK_CONFIRM_MESSAGE}</span>
      <button className="ghost" onClick={() => setBillingRisk(null)}>
        取消
      </button>
      <button className="primary" disabled={!!busy} onClick={confirmBillingRiskAction}>
        确认继续
      </button>
    </div>
  ) : null;

  return (
    <div className="workspace-card member-panel">
      <div className="workspace-head">
        <div>
          <h2>{account.label}</h2>
          <p>{account.note ? `${account.note} · ${account.workspaceName ?? account.accountId}` : (account.workspaceName ?? account.accountId)}</p>
        </div>
        <div className="workspace-actions">
          <span className="small-status">上次同步 {formatRelativeTime(account.lastRefreshAt)}</span>
          <button type="button" className="primary" onClick={() => setActiveDialog('invite')}>
            邀请成员
          </button>
          <button type="button" onClick={() => setActiveDialog('settings')}>
            Team 设置
          </button>
          <button className="ghost" onClick={onSync} disabled={syncing}>
            {syncing ? '同步中' : '同步 Team'}
          </button>
        </div>
      </div>

      <div className="summary-strip">
        <div className={`seat-summary ${atLimit ? 'warn' : ''}`}>
          <span>ChatGPT 席位</span>
          <strong>
            {chatgptSeats ?? '暂无'} / {MAX_CHATGPT_SEATS}
          </strong>
        </div>
        <div className="seat-summary">
          <span>成员</span>
          <strong>{memberCount ?? '暂无'}</strong>
        </div>
        <div className="seat-summary">
          <span>默认席位</span>
          <strong>{seatLabel(defaultSeat || null)}</strong>
        </div>
        <div className="seat-summary">
          <span>Codex 邀请</span>
          <strong>{booleanSettingLabel(workspaceReferralsEnabled)}</strong>
        </div>
        <div className="seat-summary">
          <span>访问令牌</span>
          <strong>{booleanSettingLabel(personalAccessTokensEnabled)}</strong>
        </div>
        <div className="seat-summary">
          <span>待处理邀请</span>
          <strong>{inviteCount ?? '暂无'}</strong>
        </div>
      </div>

      {busy && (
        <div className="inline-progress">
          <div className="progress-track indeterminate">
            <div className="progress-fill" />
          </div>
          <span>正在执行操作，当前页面可继续查看。</span>
        </div>
      )}
      {billingRisk && (!activeDialog || billingRisk.kind !== 'invite') && billingRiskNotice}
      {error && <div className="banner error">{error}</div>}

      {activeDialog === 'invite' && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setActiveDialog(null);
          }}
        >
          <section className="modal-panel team-dialog invite-dialog" role="dialog" aria-modal="true" aria-labelledby={inviteTitleId}>
            <div className="modal-head">
              <div>
                <h2 id={inviteTitleId}>邀请成员</h2>
                <p>发送 Team 邀请并指定这次邀请的席位类型。</p>
              </div>
            </div>
            <div className="dialog-form-grid">
              <label className="field">
                <span>邮箱</span>
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  autoFocus
                />
              </label>
              <label className="field">
                <span>席位类型</span>
                <select value={inviteSeat} onChange={(event) => setInviteSeat(event.target.value as SeatType)}>
                  <option value="usage_based">{SEAT_LABEL.usage_based}</option>
                  <option value="default">{SEAT_LABEL.default}</option>
                </select>
              </label>
            </div>
            <div className="member-profile-grid">
              <label className="field profile-note-field">
                <span>备注文本</span>
                <input
                  value={inviteProfileNote}
                  onChange={(event) => setInviteProfileNote(event.target.value)}
                  placeholder="例如客户名、用途或订单备注"
                />
              </label>
              <label className="field">
                <span>到期时间</span>
                <input
                  type="date"
                  value={inviteProfileExpiresOn}
                  onChange={(event) => setInviteProfileExpiresOn(event.target.value)}
                />
              </label>
              <div className="profile-switch-row">
                <span>到期提醒</span>
                <SettingSwitch
                  label="到期提醒"
                  checked={inviteProfileExpireReminder}
                  offLabel="关闭"
                  onChange={setInviteProfileExpireReminder}
                  onLabel="开启"
                />
              </div>
              <div className="profile-switch-row">
                <span>到期移除</span>
                <SettingSwitch
                  label="到期移除"
                  checked={inviteProfileExpireRemove}
                  offLabel="关闭"
                  onChange={setInviteProfileExpireRemove}
                  onLabel="开启"
                />
              </div>
            </div>
            {billingRisk?.kind === 'invite' && billingRiskNotice}
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setActiveDialog(null)} disabled={!!busy}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                disabled={!inviteEmail.trim() || !inviteProfileExpiresOn || busy === 'invite'}
                onClick={() => submitInvite()}
              >
                {busy === 'invite' ? '发送中' : '发送邀请'}
              </button>
            </div>
          </section>
        </div>
      )}

      {activeDialog === 'settings' && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setActiveDialog(null);
          }}
        >
          <section
            className="modal-panel team-dialog team-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={settingsTitleId}
          >
            <div className="modal-head">
              <div>
                <h2 id={settingsTitleId}>Team 设置</h2>
                <p>{account.workspaceName ?? account.accountId}</p>
              </div>
              <div className="section-actions">
                <span>上次刷新 {formatRelativeTime(settingsCachedAt)}</span>
                <button
                  type="button"
                  className="ghost tiny-action"
                  disabled={busy === 'settings-refresh'}
                  onClick={() => void run('settings-refresh', refreshSettings)}
                >
                  刷新设置
                </button>
              </div>
            </div>

            <div className="settings-dialog-body">
              <section className="settings-group">
                <div className="settings-group-head">
                  <h3>Team 资料</h3>
                </div>
                <div className="setting-list">
                  <div className="setting-row">
                    <div className="setting-copy">
                      <strong>Team 名称</strong>
                      <span>修改远端 ChatGPT workspace 名称</span>
                    </div>
                    <div className="setting-control setting-control-wide">
                      <input
                        value={teamNameDraft}
                        onChange={(event) => setTeamNameDraft(event.target.value)}
                        placeholder="新的 Team 名称"
                      />
                      <button
                        type="button"
                        className="primary"
                        disabled={busy === 'team-name' || !teamNameDraft.trim()}
                        onClick={saveTeamName}
                      >
                        {busy === 'team-name' ? '保存中' : '保存名称'}
                      </button>
                    </div>
                  </div>

                  <div className="setting-row local-profile-setting">
                    <div className="setting-copy">
                      <strong>本地资料</strong>
                      <span>只更新本系统保存的备注、分组和 session</span>
                    </div>
                    <div className="local-profile-fields">
                      <label className="field">
                        <span>母号备注</span>
                        <input
                          value={localNoteDraft}
                          onChange={(event) => setLocalNoteDraft(event.target.value)}
                          placeholder="例如自用、租给某客户、到期时间"
                        />
                      </label>
                      <label className="field">
                        <span>母号分组</span>
                        <input
                          value={localGroupNameDraft}
                          onChange={(event) => setLocalGroupNameDraft(event.target.value)}
                          placeholder="例如自用、已租车位"
                        />
                      </label>
                      <label className="field">
                        <span>新的 Session JSON</span>
                        <textarea
                          className="session-input"
                          rows={6}
                          value={localSessionDraft}
                          spellCheck={false}
                          onChange={(event) => updateLocalSessionDraft(event.target.value)}
                          placeholder="可留空。需要更换 session 时粘贴 chatgpt.com session JSON"
                        />
                      </label>
                      <label className="field compact-field">
                        <span>识别邮箱</span>
                        <input value={localSessionEmail} readOnly placeholder="粘贴 JSON 后自动识别 user.email" />
                      </label>
                    </div>
                    <div className="setting-control local-profile-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={busy === 'local-profile' || !localGroupNameDraft.trim()}
                        onClick={saveLocalProfile}
                      >
                        {busy === 'local-profile' ? '保存中' : '保存本地资料'}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="settings-group">
                <div className="settings-group-head">
                  <h3>席位与权限</h3>
                </div>
                <div className="setting-list">
                  <div className="setting-row">
                    <div className="setting-copy">
                      <strong>新成员默认席位</strong>
                      <span>上次刷新 {formatRelativeTime(defaultSeatCachedAt)}</span>
                    </div>
                    <div className="setting-control">
                      <select value={defaultSeatDraft} onChange={(event) => setDefaultSeatDraft(event.target.value as SeatType)}>
                        <option value="usage_based">{SEAT_LABEL.usage_based}</option>
                        <option value="default">{SEAT_LABEL.default}</option>
                      </select>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy === 'default-seat'}
                        onClick={() =>
                          void run('default-seat', async () => {
                            applyAccountView(await apiClient.setDefaultSeat(account.id, defaultSeatDraft));
                          })
                        }
                      >
                        {busy === 'default-seat' ? '保存中' : '保存席位'}
                      </button>
                    </div>
                  </div>

                  <div className={`setting-row ${workspaceReferralsEnabledVisible === false ? 'disabled' : ''}`}>
                    <div className="setting-copy">
                      <strong>允许成员发送 Codex 邀请</strong>
                      <span>
                        {workspaceReferralsEnabledVisible === false
                          ? '远端未开放'
                          : `上次刷新 ${formatRelativeTime(workspaceReferralsEnabledCachedAt)}`}
                      </span>
                    </div>
                    <div className="setting-control">
                      <SettingSwitch
                        label="允许成员发送 Codex 邀请"
                        checked={workspaceReferralsEnabledDraft}
                        disabled={workspaceReferralsEnabledVisible === false}
                        onChange={setWorkspaceReferralsEnabledDraft}
                      />
                      <button
                        type="button"
                        className="primary"
                        disabled={busy === 'codex-invites' || workspaceReferralsEnabledVisible === false}
                        onClick={() =>
                          void run('codex-invites', async () => {
                            applyAccountView(
                              await apiClient.setWorkspaceReferralsEnabled(account.id, workspaceReferralsEnabledDraft)
                            );
                          })
                        }
                      >
                        {busy === 'codex-invites' ? '保存中' : '保存权限'}
                      </button>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="setting-copy">
                      <strong>允许用户创建个人访问令牌</strong>
                      <span>上次刷新 {formatRelativeTime(personalAccessTokensCachedAt)}</span>
                    </div>
                    <div className="setting-control">
                      <SettingSwitch
                        label="允许用户创建个人访问令牌"
                        checked={personalAccessTokensDraft}
                        onChange={setPersonalAccessTokensDraft}
                      />
                      <button
                        type="button"
                        className="primary"
                        disabled={busy === 'personal-tokens'}
                        onClick={() =>
                          void run('personal-tokens', async () => {
                            applyAccountView(
                              await apiClient.setPersonalAccessTokensEnabled(account.id, personalAccessTokensDraft)
                            );
                          })
                        }
                      >
                        {busy === 'personal-tokens' ? '保存中' : '保存权限'}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setActiveDialog(null)} disabled={!!busy}>
                关闭
              </button>
            </div>
          </section>
        </div>
      )}

      {activeDialog === 'member-profile' && editingProfile && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setEditingProfile(null);
              setActiveDialog(null);
            }
          }}
        >
          <section
            className="modal-panel member-profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={profileTitleId}
          >
            <div className="modal-head">
              <div>
                <h2 id={profileTitleId}>编辑邮箱资料</h2>
                <p>
                  {editingProfile.email} · {editingProfile.source === 'pending' ? '待处理邀请' : '成员列表'}
                </p>
              </div>
            </div>
            <div className="member-profile-grid">
              <label className="field profile-note-field">
                <span>备注文本</span>
                <input
                  value={profileNoteDraft}
                  onChange={(event) => setProfileNoteDraft(event.target.value)}
                  placeholder="例如客户名、用途或订单备注"
                  autoFocus
                />
              </label>
              <label className="field">
                <span>到期时间</span>
                <input
                  type="date"
                  value={profileExpiresOnDraft}
                  onChange={(event) => setProfileExpiresOnDraft(event.target.value)}
                />
              </label>
              <div className="profile-switch-row">
                <span>到期提醒</span>
                <SettingSwitch
                  label="到期提醒"
                  checked={profileExpireReminderDraft}
                  offLabel="关闭"
                  onChange={setProfileExpireReminderDraft}
                  onLabel="开启"
                />
              </div>
              <div className="profile-switch-row">
                <span>到期移除</span>
                <SettingSwitch
                  label="到期移除"
                  checked={profileExpireRemoveDraft}
                  offLabel="关闭"
                  onChange={setProfileExpireRemoveDraft}
                  onLabel="开启"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setEditingProfile(null);
                  setActiveDialog(null);
                }}
                disabled={!!busy}
              >
                取消
              </button>
              <button
                type="button"
                className="primary"
                disabled={!profileExpiresOnDraft || busy === `profile-${normalizeEmail(editingProfile.email)}`}
                onClick={saveMemberProfile}
              >
                {busy === `profile-${normalizeEmail(editingProfile.email)}` ? '保存中' : '保存资料'}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="block member-block">
        <div className="section-head">
          <h3 className="title-with-loader">
            待处理邀请
            {invitesRefreshing && (
              <span className="jumping-dots" role="status" aria-label="正在更新待处理邀请">
                <span />
                <span />
                <span />
              </span>
            )}
          </h3>
          <div className="section-actions">
            <span>{inviteStatusText}</span>
            <button
              type="button"
              className="ghost tiny-action"
              disabled={invitesRefreshing}
              onClick={() => {
                setError('');
                void refreshInvites();
              }}
            >
              刷新邀请
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="member-table pending-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>本地资料</th>
                <th>角色</th>
                <th>席位</th>
                <th>邀请时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {invitesRefreshing && pendingInvites.length === 0 && (
                <>
                  <tr className="skeleton-row">
                    <td colSpan={6} />
                  </tr>
                  <tr className="skeleton-row">
                    <td colSpan={6} />
                  </tr>
                </>
              )}
              {!invitesRefreshing && pendingInvites.length === 0 && (
                <tr>
                  <td colSpan={6} className="table-empty">
                    {hasInviteSnapshot ? '暂无待处理邀请' : '尚未刷新待处理邀请'}
                  </td>
                </tr>
              )}
              {pendingInvites.map((invite) => {
                const confirming = confirmRevokeEmail === invite.email;
                const profile = profileForEmail(account.memberProfiles, invite.email);
                return (
                  <tr key={invite.inviteId || invite.email}>
                    <td data-label="邮箱">{invite.email}</td>
                    <td data-label="本地资料">
                      <div className="profile-cell">
                        <span>{profileSummary(profile)}</span>
                        {profile?.note && <small>{profile.note}</small>}
                        <button className="ghost tiny-action" onClick={() => beginEditProfile(invite.email, 'pending')}>
                          编辑资料
                        </button>
                      </div>
                    </td>
                    <td data-label="角色">{roleLabel(invite.role)}</td>
                    <td data-label="席位">{seatLabel(invite.seat)}</td>
                    <td data-label="邀请时间">{formatDateTime(invite.createdTime)}</td>
                    <td data-label="操作">
                      {!confirming && (
                        <button className="ghost danger" onClick={() => setConfirmRevokeEmail(invite.email)}>
                          撤销邀请
                        </button>
                      )}
                      {confirming && (
                        <div className="row-confirm">
                          <button className="ghost" onClick={() => setConfirmRevokeEmail('')}>
                            取消
                          </button>
                          <button
                            className="danger"
                            disabled={busy === `revoke-${invite.email}`}
                            onClick={() =>
                              void run(`revoke-${invite.email}`, async () => {
                                applyAccountView(await apiClient.revokePendingInvite(account.id, invite.email));
                                setConfirmRevokeEmail('');
                              })
                            }
                          >
                            {busy === `revoke-${invite.email}` ? '撤销中' : '确认撤销'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block member-block">
        <div className="section-head">
          <h3 className="title-with-loader">
            成员列表
            {membersRefreshing && (
              <span className="jumping-dots" role="status" aria-label="正在更新成员列表">
                <span />
                <span />
                <span />
              </span>
            )}
          </h3>
          <div className="section-actions">
            <span>{memberStatusText}</span>
            <button
              type="button"
              className="ghost tiny-action"
              disabled={membersRefreshing}
              onClick={() => {
                setError('');
                void refreshMembers();
              }}
            >
              刷新成员
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="member-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>本地资料</th>
                <th>姓名</th>
                <th>角色</th>
                <th>席位</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {membersRefreshing && members.length === 0 && (
                <>
                  <tr className="skeleton-row">
                    <td colSpan={6} />
                  </tr>
                  <tr className="skeleton-row">
                    <td colSpan={6} />
                  </tr>
                  <tr className="skeleton-row">
                    <td colSpan={6} />
                  </tr>
                </>
              )}
              {!membersRefreshing && members.length === 0 && (
                <tr>
                  <td colSpan={6} className="table-empty">
                    {hasMemberSnapshot ? '暂无成员' : '尚未刷新成员列表'}
                  </td>
                </tr>
              )}
              {members.map((member) => {
                const isOwner = member.role === 'account-owner';
                const confirming = confirmKickId === member.userId;
                const profile = profileForEmail(account.memberProfiles, member.email);
                return (
                  <tr key={member.userId}>
                    <td data-label="邮箱">{member.email}</td>
                    <td data-label="本地资料">
                      <div className="profile-cell">
                        <span>{profileSummary(profile)}</span>
                        {profile?.note && <small>{profile.note}</small>}
                        <button className="ghost tiny-action" onClick={() => beginEditProfile(member.email, 'member')}>
                          编辑资料
                        </button>
                      </div>
                    </td>
                    <td data-label="姓名">{member.name ?? '暂无'}</td>
                    <td data-label="角色">{roleLabel(member.role)}</td>
                    <td data-label="席位">
                      <select
                        value={member.seat}
                        disabled={busy === `seat-${member.userId}`}
                        onChange={(e) => changeMemberSeat(member, e.target.value as SeatType)}
                      >
                        <option value="usage_based">{SEAT_LABEL.usage_based}</option>
                        <option value="default">{SEAT_LABEL.default}</option>
                      </select>
                    </td>
                    <td data-label="操作">
                      {!isOwner && !confirming && (
                        <button className="ghost danger" onClick={() => setConfirmKickId(member.userId)}>
                          移出成员
                        </button>
                      )}
                      {!isOwner && confirming && (
                        <div className="row-confirm">
                          <button className="ghost" onClick={() => setConfirmKickId('')}>
                            取消
                          </button>
                          <button
                            className="danger"
                            disabled={busy === `kick-${member.userId}`}
                            onClick={() =>
                              void run(`kick-${member.userId}`, async () => {
                                applyAccountView(await apiClient.removeMember(account.id, member.userId));
                                setConfirmKickId('');
                              })
                            }
                          >
                            {busy === `kick-${member.userId}` ? '移出中' : '确认移出'}
                          </button>
                        </div>
                      )}
                      {isOwner && <span className="muted-action">不可移出</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
