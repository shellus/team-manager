import { useCallback, useEffect, useMemo, useState } from 'react';
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

const STATUS_LABEL: Record<SubaccountStatus, string> = {
  empty: '未录入',
  session_ready: 'Session 可用',
  codex_auth_pending: '授权中',
  codex_ready: 'Codex 可用',
  verification_required: '待验证',
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

export function SubaccountPanel({ accounts }: { accounts: AccountView[] }) {
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selected = useMemo(
    () => subaccounts.find((subaccount) => subaccount.id === selectedId) ?? subaccounts[0] ?? null,
    [selectedId, subaccounts]
  );
  const parentAccountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  );
  const linkLabel = useCallback(
    (link: SubaccountTeamLink) => parentAccountById.get(link.accountId)?.label ?? link.accountId,
    [parentAccountById]
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
    setQuota(null);
    setCredentialJson('');
    setAuthSession(null);
    setCallbackUrl('');
    setNotice('');
    setConfirmRemoveId('');
    if (selected?.id) {
      loadLogs(selected.id).catch((e) => setError((e as Error).message));
    } else {
      setLogs([]);
    }
  }, [selected?.id, loadLogs]);

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
    const added = await apiClient.importSubaccountCodexCredential(payload);
    mergeSubaccount(added);
    setNotice('已导入 Codex 凭证。');
    loadLogs(added.id).catch((e) => setError((e as Error).message));
  };

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

  const linkChatgptAccountId = (link: SubaccountTeamLink) =>
    parentAccountById.get(link.accountId)?.accountId ?? '';

  const renderCredentialRow = (link: SubaccountTeamLink) => {
    const accountId = linkChatgptAccountId(link);
    const credential = accountId ? credentialByAccountId.get(accountId) : undefined;
    const label = linkLabel(link);
    const busyStart = targetKey('codex-start', accountId);
    const busyAuto = targetKey('codex-auto', accountId);
    const busyQuota = targetKey('quota-refresh', accountId);
    const busyExport = targetKey('credential-export', accountId);
    const autoAuthUnavailable = runtimeStatus?.codexAutoAuth === false;
    return (
      <div className="credential-team-row" key={link.accountId}>
        <div>
          <strong title={label}>{label}</strong>
          <span>{link.seat === 'default' ? 'ChatGPT 席位' : 'Codex 席位'} · {TEAM_LINK_STATUS_LABEL[link.status]}</span>
        </div>
        <div className={`credential-row-status ${credential ? 'ready' : ''}`}>
          <strong>{credential ? '凭证已生成' : '未生成凭证'}</strong>
          <span>{credential?.lastAuthAt ? `授权 ${formatRelativeTime(credential.lastAuthAt)}` : accountId ? '需要选择此 Team 授权' : '缺少 workspace id'}</span>
        </div>
        <div className="credential-row-quota">
          <strong>{quotaLabel(credential)}</strong>
          <span>{credential?.lastQuotaAt ? `刷新 ${formatRelativeTime(credential.lastQuotaAt)}` : '暂无额度缓存'}</span>
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

      <section className="accounts-pane subaccount-list-pane" aria-label="子号列表">
        <div className="pane-head">
          <div>
            <h2>子号</h2>
            <span>{subaccounts.length} 个账号</span>
          </div>
          <div className="pane-actions">
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
              <article
                key={subaccount.id}
                className={`account-card subaccount-card ${selected?.id === subaccount.id ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(subaccount.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedId(subaccount.id);
                  }
                }}
              >
                <div className="card-head">
                  <div className="card-title-wrap">
                    <div className="card-title">{subaccount.label}</div>
                    {!repeatedEmail && <div className="card-sub">{subaccount.email}</div>}
                  </div>
                  <div className="card-head-actions">
                    <span className={`pill status-${subaccount.status === 'error' ? 'invalid' : 'active'}`}>
                      {STATUS_LABEL[subaccount.status]}
                    </span>
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
                  </div>
                </div>
                <div className="card-meta-line">
                  <span>{subaccount.hasWebSession ? 'Web Session 已录入' : '无 Web Session'}</span>
                  <span>Codex 凭证 {subaccount.codexCredentials.length} 份</span>
                  <span>更新 {formatTime(subaccount.updatedAt)}</span>
                </div>
                {subaccount.lastError && (
                  <div className="card-error" title={subaccount.lastError}>
                    {shortError(subaccount.lastError)}
                  </div>
                )}
                {confirmRemoveId === subaccount.id && (
                  <div className="inline-confirm" onClick={(event) => event.stopPropagation()}>
                    <span>仅从本系统移除，不影响 ChatGPT。</span>
                    <button className="ghost" onClick={() => setConfirmRemoveId('')}>
                      取消
                    </button>
                    <button
                      className="danger"
                      onClick={() => removeSubaccount(subaccount.id)}
                      disabled={busy === `remove-${subaccount.id}`}
                    >
                      {busy === `remove-${subaccount.id}` ? '删除中' : '确认删除'}
                    </button>
                  </div>
                )}
              </article>
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
              <div className={`runtime-capability ${runtimeCapabilityClass(runtimeStatus?.phoneOtp)}`}>
                <span>短信接码</span>
                <strong>
                  {runtimeStatus?.phoneOtp
                    ? `${runtimeStatus.phonePoolCount ?? 0} 个槽`
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
          {teamLinks.length === 0 && (
            <div className="relation-empty">
              先刷新 Team 关联，再按每个 Team workspace 生成对应的 Codex 凭证。
            </div>
          )}
          {teamLinks.length > 0 && <div className="credential-team-list">{teamLinks.map(renderCredentialRow)}</div>}
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
          <div className="log-list">
            {logs.length === 0 && <div className="table-empty">暂无日志</div>}
            {logs.map((log) => (
              <div className="log-item" key={log.id}>
                <div>
                  <strong>{log.phase}</strong>
                  <span>{log.status}</span>
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
