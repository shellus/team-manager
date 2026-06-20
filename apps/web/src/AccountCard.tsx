import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { AccountView } from '@team-manager/shared';
import { MAX_CHATGPT_SEATS } from '@team-manager/shared';
import { planLabel, roleLabel } from './labels.js';

function formatAccountError(error: string): string {
  if (error.includes('<!doctype') || error.includes('Unexpected token')) {
    return '同步失败：ChatGPT 返回网页内容，请检查隧道或 token 状态。';
  }
  return error.length > 96 ? `${error.slice(0, 96)}...` : error;
}

export function AccountCard({
  account,
  selected,
  syncing,
  confirmingRemove,
  removing,
  onSelect,
  onEditLocalProfile,
  onRename,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove
}: {
  account: AccountView;
  selected: boolean;
  syncing: boolean;
  confirmingRemove: boolean;
  removing: boolean;
  onSelect: () => void;
  onEditLocalProfile: () => void;
  onRename: (name: string) => Promise<void>;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(account.workspaceName ?? '');
  const [renameBusy, setRenameBusy] = useState(false);
  const memberCount = account.membersCache ? account.membersCache.length : undefined;
  const seatCount = account.membersCache
    ? account.membersCache.filter((member) => member.seat === 'default').length
    : undefined;
  const atLimit = seatCount !== undefined && seatCount >= MAX_CHATGPT_SEATS;
  const status = account.status ?? 'unknown';
  const statusLabel =
    status === 'active' ? '正常' : status === 'invalid' ? '失效' : '待同步';
  const refreshedAt = account.lastRefreshAt
    ? new Date(account.lastRefreshAt).toLocaleString('zh-CN', { hour12: false })
    : '未同步';
  const selectOnKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };
  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = renameValue.trim();
    if (!next) return;
    setRenameBusy(true);
    try {
      await onRename(next);
      setRenaming(false);
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <article
      className={`account-card status-${status} ${selected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={selectOnKeyboard}
    >
      <div className="card-head">
        <div className="card-title-wrap">
          <div className="card-title">{account.label}</div>
          <div className="card-sub">{account.workspaceName ?? account.email}</div>
        </div>
        <div className="card-head-actions">
          <span className={`pill status-${status}`}>{syncing ? '同步中' : statusLabel}</span>
          <details className="card-menu" onClick={(event) => event.stopPropagation()}>
            <summary aria-label="更多操作">⋮</summary>
            <div className="menu-content">
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  onEditLocalProfile();
                }}
              >
                编辑本地资料
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  setRenameValue(account.workspaceName ?? '');
                  setRenaming(true);
                }}
              >
                修改 Team 名称
              </button>
              <button
                type="button"
                className="danger menu-danger"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  onAskRemove();
                }}
              >
                删除母号
              </button>
            </div>
          </details>
        </div>
      </div>

      <div className="card-meta-line">
        <span>{planLabel(account.planType)}</span>
        <span>{roleLabel(account.role)}</span>
        <span>成员 {memberCount ?? '暂无'}</span>
        <span className={atLimit ? 'seat-warn' : ''}>
          ChatGPT {seatCount ?? '暂无'} / {MAX_CHATGPT_SEATS}
          {atLimit && '（满）'}
        </span>
      </div>

      <div className="card-footnote">上次同步：{refreshedAt}</div>
      {account.lastError && (
        <div className="card-error" title={account.lastError}>
          {formatAccountError(account.lastError)}
        </div>
      )}

      {renaming && (
        <form className="rename-form" onClick={(event) => event.stopPropagation()} onSubmit={submitRename}>
          <input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder="新的 Team 名称"
            autoFocus
          />
          <button type="button" className="ghost" onClick={() => setRenaming(false)}>
            取消
          </button>
          <button type="submit" className="primary" disabled={renameBusy || !renameValue.trim()}>
            {renameBusy ? '保存中' : '保存'}
          </button>
        </form>
      )}

      {confirmingRemove && (
        <div className="inline-confirm" onClick={(event) => event.stopPropagation()}>
          <span>仅从本系统移除，不影响 ChatGPT。</span>
          <button className="ghost" onClick={onCancelRemove}>取消</button>
          <button className="danger" onClick={onConfirmRemove} disabled={removing}>
            {removing ? '删除中' : '确认删除'}
          </button>
        </div>
      )}
    </article>
  );
}
