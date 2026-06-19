import { useEffect, useState, useCallback } from 'react';
import type { AccountView, Member, PendingInvite, SeatType } from '@team-manager/shared';
import { BILLING_RISK_CONFIRM_MESSAGE, MAX_CHATGPT_SEATS } from '@team-manager/shared';
import { apiClient, ApiError } from './api.js';
import { roleLabel, seatLabel, SEAT_LABEL } from './labels.js';

type ActivePanel = 'invite' | 'invites' | 'default-seat' | null;

type BillingRisk =
  | { kind: 'invite'; email: string; seat: SeatType }
  | { kind: 'member-seat'; userId: string; email: string; seat: SeatType };

type RunOptions = {
  risk?: BillingRisk;
  after?: () => Promise<void> | void;
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

function defaultSeatFromSettings(settings: Record<string, unknown>): SeatType | '' {
  const value = settings.default_seat_type;
  return value === 'default' || value === 'usage_based' ? value : '';
}

export function MemberPanel({
  account,
  syncing,
  onSync,
  onChanged
}: {
  account: AccountView;
  syncing: boolean;
  onSync: () => void;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<Member[]>(() => account.membersCache ?? []);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>(() => account.pendingInvitesCache ?? []);
  const [membersCachedAt, setMembersCachedAt] = useState(account.membersCachedAt);
  const [pendingInvitesCachedAt, setPendingInvitesCachedAt] = useState(account.pendingInvitesCachedAt);
  const [defaultSeatCachedAt, setDefaultSeatCachedAt] = useState(account.defaultSeatCachedAt);
  const [membersRefreshing, setMembersRefreshing] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesRefreshing, setInvitesRefreshing] = useState(false);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [inviteCount, setInviteCount] = useState<number | undefined>(
    account.pendingInviteCount ?? account.pendingInvitesCache?.length
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSeat, setInviteSeat] = useState<SeatType>(account.defaultSeat ?? 'usage_based');
  const [defaultSeat, setDefaultSeat] = useState<SeatType | ''>(account.defaultSeat ?? '');
  const [defaultSeatDraft, setDefaultSeatDraft] = useState<SeatType>(account.defaultSeat ?? 'usage_based');
  const [billingRisk, setBillingRisk] = useState<BillingRisk | null>(null);
  const [confirmKickId, setConfirmKickId] = useState('');
  const [confirmRevokeEmail, setConfirmRevokeEmail] = useState('');

  const loadCachedMembers = useCallback(async () => {
    try {
      setMembers(await apiClient.listMembers(account.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [account.id]);

  const loadSettings = useCallback(async () => {
    try {
      const settings = await apiClient.getSettings(account.id);
      const ds = defaultSeatFromSettings(settings);
      if (ds) {
        setDefaultSeat(ds);
        setDefaultSeatDraft(ds);
        setInviteSeat(ds);
      } else {
        setDefaultSeat('');
        setDefaultSeatDraft('usage_based');
      }
    } catch {
      setDefaultSeat('');
      setDefaultSeatDraft('usage_based');
    }
  }, [account.id]);

  const refreshSettings = useCallback(async () => {
    try {
      const settings = await apiClient.refreshSettings(account.id);
      const ds = defaultSeatFromSettings(settings);
      if (ds) {
        setDefaultSeat(ds);
        setDefaultSeatDraft(ds);
        setInviteSeat(ds);
      }
      setDefaultSeatCachedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [account.id]);

  const refreshMembers = useCallback(async (): Promise<boolean> => {
    setMembersRefreshing(true);
    try {
      setMembers(await apiClient.refreshMembers(account.id));
      setMembersCachedAt(Date.now());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setMembersRefreshing(false);
    }
  }, [account.id]);

  const loadCachedInviteCount = useCallback(async (fallback?: number) => {
    try {
      setInviteCount(await apiClient.countPendingInvites(account.id));
    } catch {
      setInviteCount(fallback);
    }
  }, [account.id]);

  const refreshInviteCount = useCallback(async (fallback?: number) => {
    try {
      setInviteCount(await apiClient.refreshPendingInviteCount(account.id));
    } catch {
      setInviteCount(fallback);
    }
  }, [account.id]);

  useEffect(() => {
    setInviteCount(account.pendingInviteCount ?? account.pendingInvitesCache?.length);
  }, [account.pendingInviteCount, account.pendingInvitesCache]);

  const loadCachedInvites = useCallback(async () => {
    setInvitesLoading(true);
    try {
      const invites = await apiClient.listPendingInvites(account.id);
      setPendingInvites(invites);
      setInviteCount(invites.length);
      setPendingInvitesCachedAt(account.pendingInvitesCachedAt);
      setInvitesLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInvitesLoading(false);
    }
  }, [account.id]);

  const refreshInvites = useCallback(async () => {
    setInvitesRefreshing(true);
    try {
      const invites = await apiClient.refreshPendingInvites(account.id);
      setPendingInvites(invites);
      setInviteCount(invites.length);
      setPendingInvitesCachedAt(Date.now());
      setInvitesLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInvitesRefreshing(false);
    }
  }, [account.id]);

  useEffect(() => {
    setMembers(account.membersCache ?? []);
    setPendingInvites(account.pendingInvitesCache ?? []);
    setMembersCachedAt(account.membersCachedAt);
    setPendingInvitesCachedAt(account.pendingInvitesCachedAt);
    setDefaultSeatCachedAt(account.defaultSeatCachedAt);
    setInvitesLoaded(false);
    setInviteCount(account.pendingInviteCount ?? account.pendingInvitesCache?.length);
    setDefaultSeat(account.defaultSeat ?? '');
    setDefaultSeatDraft(account.defaultSeat ?? 'usage_based');
    setInviteSeat(account.defaultSeat ?? 'usage_based');
    setError('');
    setBusy('');
    setActivePanel(null);
    setBillingRisk(null);
    setConfirmKickId('');
    setConfirmRevokeEmail('');
    void loadCachedMembers();
    void loadSettings();
    void loadCachedInviteCount(account.pendingInviteCount ?? account.pendingInvitesCache?.length);
  }, [account.id, account.membersCachedAt, account.pendingInvitesCachedAt, account.defaultSeatCachedAt, loadCachedMembers, loadSettings, loadCachedInviteCount]);

  useEffect(() => {
    if (account.membersCache) setMembers(account.membersCache);
  }, [account.id, account.membersCachedAt, account.membersCache]);

  const loadedChatgptSeats = members.filter((m) => m.seat === 'default').length;
  const chatgptSeats = members.length > 0 ? loadedChatgptSeats : account.chatgptSeatCount;
  const atLimit = typeof chatgptSeats === 'number' && chatgptSeats >= MAX_CHATGPT_SEATS;

  const refreshMemberRowsAfterChange = async () => {
    if (await refreshMembers()) onChanged();
  };

  const refreshInviteRowsAfterChange = async () => {
    if (invitesLoaded || activePanel === 'invites') await refreshInvites();
    else await refreshInviteCount(account.pendingInviteCount ?? account.pendingInvitesCache?.length);
    onChanged();
  };

  const refreshSettingsAfterChange = () => {
    onChanged();
  };

  const run = async (key: string, fn: () => Promise<unknown>, options: RunOptions = {}) => {
    setBusy(key);
    setError('');
    setBillingRisk(null);
    try {
      await fn();
      await options.after?.();
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

  const openPanel = (panel: ActivePanel) => {
    setActivePanel((current) => (current === panel ? null : panel));
    setBillingRisk(null);
    if (panel === 'invites') {
      setPendingInvites((current) => (current.length > 0 ? current : account.pendingInvitesCache ?? []));
      setInvitesLoaded(true);
      void loadCachedInvites();
    }
  };

  const submitInvite = (confirmBillingRisk = false, preset?: Extract<BillingRisk, { kind: 'invite' }>) => {
    const email = (preset?.email ?? inviteEmail).trim();
    const seat = preset?.seat ?? inviteSeat;
    if (!email) return;
    void run(
      'invite',
      async () => {
        await apiClient.invite(account.id, email, seat, confirmBillingRisk);
        setInviteEmail('');
      },
      {
        risk: { kind: 'invite', email, seat },
        after: refreshInviteRowsAfterChange
      }
    );
  };

  const changeMemberSeat = (
    member: Member,
    seat: SeatType,
    confirmBillingRisk = false
  ) => {
    void run(
      `seat-${member.userId}`,
      () => apiClient.setMemberSeat(account.id, member.userId, seat, confirmBillingRisk),
      {
        risk: { kind: 'member-seat', userId: member.userId, email: member.email, seat },
        after: refreshMemberRowsAfterChange
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

  return (
    <div className="workspace-card member-panel">
      <div className="workspace-head">
        <div>
          <h2>{account.label}</h2>
          <p>{account.workspaceName ?? account.accountId}</p>
        </div>
        <div className="workspace-actions">
          <span className="small-status">上次刷新 {formatRelativeTime(account.lastRefreshAt)}</span>
          <button className="ghost" onClick={onSync} disabled={syncing}>
            {syncing ? '刷新中' : '刷新'}
          </button>
          <details className="card-menu workspace-menu">
            <summary aria-label="更多操作">⋮</summary>
            <div className="menu-content">
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  openPanel('invite');
                }}
              >
                邀请新成员
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  openPanel('default-seat');
                }}
              >
                修改默认席位
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  openPanel('invites');
                }}
              >
                查看待处理邀请
              </button>
            </div>
          </details>
        </div>
      </div>

      <div className="summary-strip">
        <div className={`seat-summary ${atLimit ? 'warn' : ''}`}>
          <span>ChatGPT 席位</span>
          <strong>{chatgptSeats ?? '暂无'} / {MAX_CHATGPT_SEATS}</strong>
        </div>
        <div className="seat-summary">
          <span>成员</span>
          <strong>{members.length || account.memberCount || '暂无'}</strong>
        </div>
        <div className="seat-summary">
          <span>默认席位</span>
          <strong>{seatLabel(defaultSeat || null)}</strong>
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
      {billingRisk && (
        <div className="billing-risk">
          <span>{BILLING_RISK_CONFIRM_MESSAGE}</span>
          <button className="ghost" onClick={() => setBillingRisk(null)}>
            取消
          </button>
          <button className="primary" disabled={!!busy} onClick={confirmBillingRiskAction}>
            确认继续
          </button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      {activePanel === 'invite' && (
        <section className="action-panel">
          <div className="section-head">
            <h3>邀请新成员</h3>
          </div>
          <div className="form-row">
            <input
              type="email"
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select value={inviteSeat} onChange={(e) => setInviteSeat(e.target.value as SeatType)}>
              <option value="usage_based">{SEAT_LABEL.usage_based}</option>
              <option value="default">{SEAT_LABEL.default}</option>
            </select>
            <button
              className="primary"
              disabled={!inviteEmail.trim() || busy === 'invite'}
              onClick={() => submitInvite()}
            >
              {busy === 'invite' ? '发送中' : '发送邀请'}
            </button>
          </div>
        </section>
      )}

      {activePanel === 'default-seat' && (
        <section className="action-panel">
          <div className="section-head">
            <h3>新成员默认席位</h3>
            <div className="section-actions">
              <span>上次刷新 {formatRelativeTime(defaultSeatCachedAt)}</span>
              <button
                type="button"
                className="ghost tiny-action"
                disabled={busy === 'settings-refresh'}
                onClick={() => void run('settings-refresh', refreshSettings)}
              >
                刷新
              </button>
            </div>
          </div>
          <div className="form-row compact">
            <select value={defaultSeatDraft} onChange={(e) => setDefaultSeatDraft(e.target.value as SeatType)}>
              <option value="usage_based">{SEAT_LABEL.usage_based}</option>
              <option value="default">{SEAT_LABEL.default}</option>
            </select>
            <button
              className="primary"
              disabled={busy === 'default-seat'}
              onClick={() =>
                void run('default-seat', async () => {
                  await apiClient.setDefaultSeat(account.id, defaultSeatDraft);
                  setDefaultSeat(defaultSeatDraft);
                  setActivePanel(null);
                }, { after: refreshSettingsAfterChange })
              }
            >
              {busy === 'default-seat' ? '保存中' : '保存'}
            </button>
          </div>
        </section>
      )}

      {activePanel === 'invites' && (
        <section className="action-panel member-block">
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
              <span>{pendingInvites.length} 条，上次刷新 {formatRelativeTime(pendingInvitesCachedAt)}</span>
              <button
                type="button"
                className="ghost tiny-action"
                disabled={invitesRefreshing}
                onClick={() => void refreshInviteRowsAfterChange()}
              >
                刷新
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="member-table pending-table">
              <thead>
                <tr>
                  <th>邮箱</th>
                  <th>角色</th>
                  <th>席位</th>
                  <th>邀请时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(invitesLoading || invitesRefreshing) && pendingInvites.length === 0 && (
                  <>
                    <tr className="skeleton-row"><td colSpan={5} /></tr>
                    <tr className="skeleton-row"><td colSpan={5} /></tr>
                  </>
                )}
                {!invitesLoading && !invitesRefreshing && pendingInvites.length === 0 && (
                  <tr>
                    <td colSpan={5} className="table-empty">暂无待处理邀请</td>
                  </tr>
                )}
                {pendingInvites.map((invite) => {
                  const confirming = confirmRevokeEmail === invite.email;
                  return (
                    <tr key={invite.inviteId || invite.email}>
                      <td>{invite.email}</td>
                      <td>{roleLabel(invite.role)}</td>
                      <td>{seatLabel(invite.seat)}</td>
                      <td>{formatDateTime(invite.createdTime)}</td>
                      <td>
                        {!confirming && (
                          <button className="ghost danger" onClick={() => setConfirmRevokeEmail(invite.email)}>
                            撤销
                          </button>
                        )}
                        {confirming && (
                          <div className="row-confirm">
                            <button className="ghost" onClick={() => setConfirmRevokeEmail('')}>取消</button>
                            <button
                              className="danger"
                              disabled={busy === `revoke-${invite.email}`}
                              onClick={() =>
                                void run(`revoke-${invite.email}`, async () => {
                                  await apiClient.revokePendingInvite(account.id, invite.email);
                                  setConfirmRevokeEmail('');
                                }, { after: refreshInviteRowsAfterChange })
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
      )}

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
            <span>{members.length} 人，上次刷新 {formatRelativeTime(membersCachedAt)}</span>
            <button
              type="button"
              className="ghost tiny-action"
              disabled={membersRefreshing}
              onClick={() => {
                setError('');
                void refreshMemberRowsAfterChange();
              }}
            >
              刷新
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="member-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>姓名</th>
                <th>角色</th>
                <th>席位</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {membersRefreshing && members.length === 0 && (
                <>
                  <tr className="skeleton-row"><td colSpan={5} /></tr>
                  <tr className="skeleton-row"><td colSpan={5} /></tr>
                  <tr className="skeleton-row"><td colSpan={5} /></tr>
                </>
              )}
              {!membersRefreshing && members.length === 0 && (
                <tr>
                  <td colSpan={5} className="table-empty">暂无成员</td>
                </tr>
              )}
              {members.map((m) => {
                const isOwner = m.role === 'account-owner';
                const confirming = confirmKickId === m.userId;
                return (
                  <tr key={m.userId}>
                    <td>{m.email}</td>
                    <td>{m.name ?? '暂无'}</td>
                    <td>{roleLabel(m.role)}</td>
                    <td>
                      <select
                        value={m.seat}
                        disabled={busy === `seat-${m.userId}`}
                        onChange={(e) => changeMemberSeat(m, e.target.value as SeatType)}
                      >
                        <option value="usage_based">{SEAT_LABEL.usage_based}</option>
                        <option value="default">{SEAT_LABEL.default}</option>
                      </select>
                    </td>
                    <td>
                      {!isOwner && !confirming && (
                        <button className="ghost danger" onClick={() => setConfirmKickId(m.userId)}>
                          移出
                        </button>
                      )}
                      {!isOwner && confirming && (
                        <div className="row-confirm">
                          <button className="ghost" onClick={() => setConfirmKickId('')}>取消</button>
                          <button
                            className="danger"
                            disabled={busy === `kick-${m.userId}`}
                            onClick={() =>
                              void run(
                                `kick-${m.userId}`,
                                () => apiClient.removeMember(account.id, m.userId),
                                { after: refreshMemberRowsAfterChange }
                              )
                            }
                          >
                            {busy === `kick-${m.userId}` ? '移出中' : '确认移出'}
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
    </div>
  );
}
