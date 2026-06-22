import { useEffect, useId, useState, useCallback } from 'react';
import type { AccountView } from '@team-manager/shared';
import { apiClient, getToken, setToken, clearToken } from './api.js';
import { Login } from './Login.js';
import { AccountCard } from './AccountCard.js';
import { MemberPanel } from './MemberPanel.js';
import { SubaccountPanel } from './SubaccountPanel.js';
import { SessionImportDialog } from './SessionImportDialog.js';

export function App() {
  const removeDialogTitleId = useId();
  const [authed, setAuthed] = useState(!!getToken());
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState<'members' | 'empty'>('empty');
  const [section, setSection] = useState<'parents' | 'subaccounts'>('parents');
  const [syncingIds, setSyncingIds] = useState<Set<string>>(() => new Set());
  const [confirmRemoveId, setConfirmRemoveId] = useState('');
  const [removingId, setRemovingId] = useState('');
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);

  const selected = accounts.find((account) => account.id === selectedId) ?? null;
  const removingAccount = accounts.find((account) => account.id === confirmRemoveId) ?? null;
  const removingAccountBusy = removingAccount ? removingId === removingAccount.id : false;

  const mergeAccount = useCallback((updated: AccountView) => {
    setAccounts((current) => current.map((account) => (account.id === updated.id ? updated : account)));
  }, []);

  const markSyncing = useCallback((id: string, syncing: boolean) => {
    setSyncingIds((current) => {
      const next = new Set(current);
      if (syncing) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const syncAccount = useCallback(
    async (id: string) => {
      markSyncing(id, true);
      setError('');
      try {
        mergeAccount(await apiClient.refreshAccount(id));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        markSyncing(id, false);
      }
    },
    [markSyncing, mergeAccount]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await apiClient.listAccounts();
      setAccounts(next);
      setSelectedId((current) => current || next[0]?.id || '');
      setMode(next.length > 0 ? 'members' : 'empty');
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message.includes('登录')) setAuthed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) refresh();
  }, [authed, refresh]);

  useEffect(() => {
    if (!removingAccount) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !removingAccountBusy) setConfirmRemoveId('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [removingAccount, removingAccountBusy]);

  if (!authed) {
    return (
      <Login
        onLogin={async (u, p) => {
          const { token } = await apiClient.login(u, p);
          setToken(token);
          setAuthed(true);
        }}
      />
    );
  }

  const removeAccount = async (id: string) => {
    setRemovingId(id);
    setError('');
    try {
      await apiClient.removeAccount(id);
      setAccounts((current) => {
        const next = current.filter((account) => account.id !== id);
        if (selectedId === id) {
          setSelectedId(next[0]?.id || '');
          setMode(next.length > 0 ? 'members' : 'empty');
        }
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemovingId('');
      setConfirmRemoveId('');
    }
  };

  const renameTeam = async (id: string, name: string) => {
    setError('');
    try {
      const updated = await apiClient.renameTeam(id, name);
      mergeAccount(updated);
      return updated;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };

  const updateAccountLocalProfile = async (
    id: string,
    payload: { label: string; session?: Record<string, unknown> }
  ) => {
    setError('');
    try {
      const updated = await apiClient.updateAccountLocalProfile(id, payload);
      mergeAccount(updated);
      return updated;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Team 管理</h1>
          <p>管理母号 workspace、子号凭证和 Codex 额度</p>
        </div>
        <div className="topbar-actions">
          <div className="segmented">
            <button
              className={section === 'parents' ? 'selected' : ''}
              onClick={() => setSection('parents')}
            >
              母号
            </button>
            <button
              className={section === 'subaccounts' ? 'selected' : ''}
              onClick={() => setSection('subaccounts')}
            >
              子号
            </button>
          </div>
          <button
            className="ghost"
            onClick={() => {
              clearToken();
              setAuthed(false);
            }}
          >
            退出
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <SessionImportDialog
        open={accountDialogOpen}
        title="录入母号 Session"
        description="保存后先创建本地记录，ChatGPT 状态在母号详情中手动同步。"
        submitLabel="保存母号"
        busyLabel="正在保存母号本地记录"
        onClose={() => setAccountDialogOpen(false)}
        onSubmit={async (payload) => {
          const account = await apiClient.addAccount(payload);
          setAccounts((current) => [account, ...current]);
          setSelectedId(account.id);
          setMode('members');
          setSection('parents');
        }}
      />

      {removingAccount && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !removingAccountBusy) setConfirmRemoveId('');
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
                <h2 id={removeDialogTitleId}>删除母号</h2>
                <p>{removingAccount.label}</p>
              </div>
            </div>
            <div className="confirm-copy">
              仅从本系统移除这个母号本地记录，不会修改 ChatGPT Team workspace 或远端成员。
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setConfirmRemoveId('')} disabled={removingAccountBusy}>
                取消
              </button>
              <button
                className="danger"
                onClick={() => void removeAccount(removingAccount.id)}
                disabled={removingAccountBusy}
              >
                {removingAccountBusy ? '删除中' : '确认删除'}
              </button>
            </div>
          </section>
        </div>
      )}

      {section === 'subaccounts' && (
        <main className="subaccount-page">
          <SubaccountPanel accounts={accounts} />
        </main>
      )}

      {section === 'parents' && (
        <main className="app-layout">
          <section className="accounts-pane" aria-label="母号列表">
            <div className="pane-head">
              <div>
                <h2>母号</h2>
                <span>{accounts.length} 个 workspace</span>
              </div>
              <div className="section-actions">
                {loading && <span className="small-status">读取缓存中</span>}
                <button className="primary" onClick={() => setAccountDialogOpen(true)}>
                  录入母号
                </button>
              </div>
            </div>

            <div className="account-list">
              {loading && accounts.length === 0 && (
                <>
                  <div className="account-skeleton" />
                  <div className="account-skeleton" />
                  <div className="account-skeleton" />
                </>
              )}
              {accounts.length === 0 && !loading && (
                <div className="empty-panel">
                  <h3>还没有母号</h3>
                  <p>录入 session JSON 后会先创建本地记录，ChatGPT 状态在详情中手动同步。</p>
                  <button className="primary" onClick={() => setAccountDialogOpen(true)}>
                    录入母号
                  </button>
                </div>
              )}
              {accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  selected={account.id === selectedId}
                  syncing={syncingIds.has(account.id)}
                  onSelect={() => {
                    setSelectedId(account.id);
                    setMode('members');
                  }}
                  onAskRemove={() => setConfirmRemoveId(account.id)}
                />
              ))}
            </div>
          </section>

          <section className="workspace-pane" aria-label="工作区">
            {mode === 'members' && selected && (
              <MemberPanel
                account={selected}
                syncing={syncingIds.has(selected.id)}
                onSync={() => {
                  void syncAccount(selected.id);
                }}
                onAccountChanged={mergeAccount}
                onRenameTeam={renameTeam}
                onUpdateLocalProfile={updateAccountLocalProfile}
              />
            )}
            {(!selected || mode === 'empty') && (
              <div className="empty-workspace">
                <h2>选择一个母号开始管理</h2>
                <p>列表会先显示本地缓存，ChatGPT 状态同步在后台进行。</p>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
